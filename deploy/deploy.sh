#!/usr/bin/env bash
#
# Выложить Article Quality Checker на Bitrix24 VibeCode:
#
#   bash deploy/deploy.sh
#
# Секреты (VIBE_KEY, ACCESS_PIN) скрипт берёт по приоритету:
#   1. уже экспортированные переменные окружения (например, из CI);
#   2. файл deploy/.env.deploy (в гит не попадает — см. .gitignore); заведи
#      его один раз командой `cp deploy/.env.deploy.example deploy/.env.deploy`
#      и впиши туда ключи — при повторных деплоях набирать их заново не надо;
#   3. если нигде не нашлись — скрипт спросит их интерактивно через `read -s`,
#      без вывода на экран и без попадания в историю шелла.
#
# Так ключи не остаются в истории команд (`.bash_history`/`.zsh_history`) и не
# светятся в выводе `ps aux` как аргументы командной строки.
#
# В отличие от чисто статических сайтов, этому приложению нужен постоянно
# работающий Node/Express-процесс: он держит VIBE_KEY на сервере (ключ
# никогда не должен попасть в браузер) — тот же ключ, что и для деплоя,
# используется приложением в рантайме для вызова AI Router VibeCode
# (модель bitrix/bitrixgpt-5.5, см. server/lib/vibeAiClient.js) — и ведёт
# серверный счётчик прогонов. Поэтому вместо runtime=static (только nginx)
# здесь запрашивается runtime=node20.
#
# Платформа деплоит такие приложения как GALAXY-контейнер (общий хост), а не
# отдельную VM — и в этом режиме runtime нужно передавать в КАЖДОМ запросе
# деплоя (и при первом создании, и при каждом обновлении), иначе платформа
# отвечает GALAXY_DEPLOY_RUNTIME_REQUIRED. Раньше runtime передавался только
# при создании сервера (по образцу standalone-VM скрипта из
# vibecoders-front-ui-gallery/deploy/deploy.sh) — из-за этого повторный
# деплой на уже существующий сервер падал с той же ошибкой.
#
# ⚠️ Базовый URL AI Router в server/lib/vibeAiClient.js — по-прежнему
# непроверенное предположение (см. комментарий там же и deploy/README.md).
# Если после деплоя `/api/analyze` отдаёт 502 — проверь путь AI Router и
# формат авторизации в личном кабинете VibeCode.

API="https://vibecode.bitrix24.tech/v1"
PLAN="bc-small"                    # тариф сервера (дешевле — bc-agent)
REGION="ru-central1-a"             # дата-центр (Москва)
NAME="article-quality-checker"     # имя сервера на платформе
RUNTIME_IMAGE="node20"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
IDFILE="$HERE/.vibe-server"      # сюда запомним id созданного сервера (в гит не нужен)
ENVFILE="$HERE/.env.deploy"      # сюда можно один раз положить ключи (в гит не нужен)

# 2. Файл deploy/.env.deploy, если он есть и переменная ещё не задана снаружи.
if [ -f "$ENVFILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENVFILE"
  set +a
fi

# 3. Если ключа всё ещё нет — спрашиваем интерактивно, без эха на экран.
if [ -z "${VIBE_KEY:-}" ]; then
  read -rsp "VIBE_KEY (vibe_api_...): " VIBE_KEY; echo
fi

if [ -z "${VIBE_KEY:-}" ]; then
  echo "❌ VIBE_KEY не задан."
  exit 1
fi
ACCESS_PIN="${ACCESS_PIN:-2847}"
VIBE_AI_MODEL="${VIBE_AI_MODEL:-bitrix/bitrixgpt-5.5}"
VIBE_AI_BASE_URL="${VIBE_AI_BASE_URL:-https://vibecode.bitrix24.tech/v1/ai}"

api() { curl -s -H "X-Api-Key: $VIBE_KEY" "$@"; }
# вытащить строковое поле из JSON-ответа (чтобы не зависеть от jq)
field() { grep -oE "\"$1\":\"[^\"]*\"" | head -1 | sed -E "s/.*:\"([^\"]*)\"/\1/"; }

echo "→ 1/5  Собираю фронтенд (npm run build)…"
( cd "$ROOT" && npm run build >/dev/null ) || { echo "❌ Сборка упала"; exit 1; }

echo "→ 2/5  Ставлю прод-зависимости и пакую сервер + dist…"
WORK="$(mktemp -d)"
[ -n "$WORK" ] && [ -d "$WORK" ] || { echo "❌ Не удалось создать временную папку"; exit 1; }
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/stage"
cp -r "$ROOT/server" "$WORK/stage/server"
cp -r "$ROOT/dist" "$WORK/stage/dist"
cp "$ROOT/package.json" "$WORK/stage/"
[ -f "$ROOT/package-lock.json" ] && cp "$ROOT/package-lock.json" "$WORK/stage/"
# Секреты кладём в .env внутри архива, а не в переменные окружения платформы —
# так деплой не зависит от того, поддерживает ли VibeCode свой механизм env-переменных.
cat > "$WORK/stage/.env" <<EOF
ACCESS_PIN=$ACCESS_PIN
VIBE_KEY=$VIBE_KEY
VIBE_AI_MODEL=$VIBE_AI_MODEL
VIBE_AI_BASE_URL=$VIBE_AI_BASE_URL
EOF
( cd "$WORK/stage" && npm ci --omit=dev --ignore-scripts >/dev/null ) || { echo "❌ npm ci упал"; exit 1; }
tar -czf "$WORK/app.tgz" -C "$WORK/stage" .

if [ -f "$IDFILE" ]; then
  SID="$(cat "$IDFILE")"
  echo "→ 3/5  Использую существующий сервер: $SID"
else
  echo "→ 3/5  Создаю сервер ($PLAN, $REGION, runtime=$RUNTIME_IMAGE)… (это платный шаг)"
  IMAGE="$(api "$API/infra/providers/bitrix-cloud/images" | field id)"
  RESP="$(api -X POST "$API/infra/servers" -H "Content-Type: application/json" \
      -d "{\"provider\":\"bitrix-cloud\",\"name\":\"$NAME\",\"plan\":\"$PLAN\",\"region\":\"$REGION\",\"image\":\"$IMAGE\",\"runtime\":\"$RUNTIME_IMAGE\"}")"
  SID="$(printf '%s' "$RESP" | field id)"
  if [ -z "$SID" ]; then echo "❌ Сервер не создался: $RESP"; exit 1; fi
  printf '%s' "$SID" > "$IDFILE"
  printf "   жду готовности сервера"
  for _ in $(seq 1 30); do
    if api "$API/infra/servers/$SID" | grep -q '"blackholeStatus":"CONNECTED"'; then break; fi
    printf "."; sleep 6
  done
  echo " — готов"
fi

echo "→ 4/5  Заливаю приложение на сервер…"
# runtime передаём и здесь тоже (не только при создании) — иначе
# GALAXY_DEPLOY_RUNTIME_REQUIRED повторяется на каждом повторном деплое.
DRESP="$(api -X POST "$API/infra/servers/$SID/deploy?stream=false" \
    -F "archive=@$WORK/app.tgz" -F "runtime=$RUNTIME_IMAGE" \
    -F "start=node server/index.js" -F "port=3000" -F "cleanDeploy=true")"
if ! printf '%s' "$DRESP" | grep -q '"success":true'; then
  echo "❌ Деплой не удался:"; echo "$DRESP"; exit 1
fi
URL="$(printf '%s' "$DRESP" | field appUrl)"

echo "→ 5/5  Делаю сайт публичным и не засыпающим…"
api -X PATCH "$API/infra/servers/$SID/access-policy" -H "Content-Type: application/json" -d '{"accessPolicy":"PUBLIC"}' >/dev/null
api -X PATCH "$API/infra/servers/$SID/sleep"         -H "Content-Type: application/json" -d '{"sleepAfterMinutes":null}' >/dev/null

echo
echo "✅ Готово! Твой сайт онлайн:"
echo "   $URL"
