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
# Приложение деплоится как GALAXY-контейнер (общий хост), а не отдельная VM —
# см. deploy-galaxy.sh в vibecoders-front-ui-gallery/deploy. Три вещи,
# которые отличают этот путь от standalone-VM (и на которых этот скрипт
# спотыкался по очереди, пока не выяснилось опытным путём):
#   1. runtime нужно передавать в КАЖДОМ запросе деплоя (и при создании, и
#      при каждом обновлении) — иначе GALAXY_DEPLOY_RUNTIME_REQUIRED.
#   2. готовность проверяется через status=running, а не
#      blackholeStatus=CONNECTED (тот статус Galaxy никогда не достигает).
#   3. САМОЕ ГЛАВНОЕ: и создание, и (ре)деплой — это ОДИН JSON-запрос с
#      исходниками в поле source.content как base64, а НЕ multipart-загрузка
#      файла (`-F "archive=@..."`). С multipart платформа отвечала 200 OK,
#      создавала app slot, но реального деплоя не запускала («No source was
#      deployed — the app slot was created but a deploy never started»),
#      потому что просто не понимала поле archive.
#
# ⚠️ Базовый URL AI Router в server/lib/vibeAiClient.js — по-прежнему
# непроверенное предположение (см. комментарий там же и deploy/README.md).
# Если после деплоя `/api/analyze` отдаёт 502 — проверь путь AI Router и
# формат авторизации в личном кабинете VibeCode, а быстрее — глянь
# /api/health.aiTest сразу после деплоя.

set -u
API="https://vibecode.bitrix24.tech/v1"
NAME="article-quality-checker"     # имя приложения на платформе
RUNTIME_IMAGE="node20"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
IDFILE="$HERE/.vibe-server"      # сюда запомним id приложения (в гит не нужен)
ENVFILE="$HERE/.env.deploy"      # сюда можно один раз положить ключи (в гит не нужен)

if [ -f "$ENVFILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENVFILE"
  set +a
fi

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
# Опционален: без него /admin/stats просто отвечает 500 и остаётся выключен
# (не открывается без пароля и не падает на дефолтный).
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
# Опциональны: без них /api/articles отвечает 502 и выбор статьи по Title
# недоступен — см. server/lib/googleClient.js и .env.example.
GOOGLE_SERVICE_ACCOUNT_KEY_BASE64="${GOOGLE_SERVICE_ACCOUNT_KEY_BASE64:-}"
GOOGLE_SHEET_ID="${GOOGLE_SHEET_ID:-}"
GOOGLE_SHEET_RANGE="${GOOGLE_SHEET_RANGE:-}"

api()   { curl -s -H "X-Api-Key: $VIBE_KEY" "$@"; }
# вытащить строковое поле из JSON-ответа (чтобы не зависеть от jq)
field() { grep -oE "\"$1\":\"[^\"]*\"" | head -1 | sed -E "s/.*:\"([^\"]*)\"/\1/"; }
# base64 без переносов строк — на GNU (Linux/Git Bash) есть -w0, на BSD/macOS нет
b64() {
  if base64 --help 2>&1 | grep -q -- '-w'; then base64 -w0 "$1"; else base64 "$1" | tr -d '\n'; fi
}

echo "→ 1/5  Собираю фронтенд (npm run build)…"
( cd "$ROOT" && npm run build >/dev/null ) || { echo "❌ Сборка упала"; exit 1; }

echo "→ 2/5  Ставлю прод-зависимости и кодирую архив в base64…"
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
ADMIN_PASSWORD=$ADMIN_PASSWORD
GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=$GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
GOOGLE_SHEET_ID=$GOOGLE_SHEET_ID
GOOGLE_SHEET_RANGE=$GOOGLE_SHEET_RANGE
EOF
( cd "$WORK/stage" && npm ci --omit=dev --ignore-scripts >/dev/null ) || { echo "❌ npm ci упал"; exit 1; }
tar -czf "$WORK/app.tgz" -C "$WORK/stage" .

# base64 крупный — JSON-тело кладём в файл, не в командную строку (argv лимит)
{
  printf '{"name":"%s","runtime":"%s","port":3000,"start":"node server/index.js","source":{"content":"' \
    "$NAME" "$RUNTIME_IMAGE"
  b64 "$WORK/app.tgz"
  printf '"}}'
} > "$WORK/body.json"

DEPLOY_TIMEOUT_OPTS=(--connect-timeout 15 --max-time 240)

if [ -f "$IDFILE" ]; then
  SID="$(cat "$IDFILE")"
  echo "→ 3/5  Передеплой существующего приложения: $SID (тайм-аут 4 мин на сам запрос)…"
  # На Galaxy этот запрос не обязан синхронно вернуть готовый результат —
  # тайм-аут/обрыв здесь не фатален, реальную готовность всё равно
  # проверяем следующим шагом через status=running.
  RESP="$(api "${DEPLOY_TIMEOUT_OPTS[@]}" -X POST "$API/infra/servers/$SID/deploy?stream=false" \
      -H "Content-Type: application/json" --data-binary @"$WORK/body.json")"
  CURL_EXIT=$?
  if [ "$CURL_EXIT" -ne 0 ]; then
    echo "⚠️  Запрос не дождался ответа за 4 мин (curl exit $CURL_EXIT) — возможно, сборка"
    echo "    продолжается на сервере в фоне. Проверяю статус напрямую…"
  elif printf '%s' "$RESP" | grep -q '"error"'; then
    echo "❌ Деплой отклонён:"; echo "$RESP"; exit 1
  fi
else
  echo "→ 3/5  Создаю приложение (one-shot, с исходниками)… (это платный шаг)"
  SID=""
  for attempt in $(seq 1 5); do
    RESP="$(api "${DEPLOY_TIMEOUT_OPTS[@]}" -X POST "$API/infra/servers" \
        -H "Content-Type: application/json" --data-binary @"$WORK/body.json")"
    CURL_EXIT=$?
    if [ "$CURL_EXIT" -ne 0 ]; then
      echo "❌ Запрос создания не дождался ответа за 4 мин (curl exit $CURL_EXIT)."
      echo "   ВАЖНО: приложение могло всё же создаться на сервере, несмотря на то что"
      echo "   ответ до нас не дошёл. Прежде чем повторять — открой личный кабинет"
      echo "   VibeCode и проверь, нет ли уже приложения «$NAME», чтобы не создать дубль."
      exit 1
    fi
    SID="$(printf '%s' "$RESP" | field id)"
    [ -n "$SID" ] && break
    # Ретраим ТОЛЬКО «мигание» режима портала; любую другую ошибку — наружу
    if printf '%s' "$RESP" | grep -q "SOURCE_AT_CREATE_GALAXY_ONLY"; then
      echo "   попытка $attempt/5: портал ушёл в standalone (SOURCE_AT_CREATE_GALAXY_ONLY), повтор через 8с…"
      sleep 8
      continue
    fi
    echo "❌ Не создалось: $RESP"; exit 1
  done
  if [ -z "$SID" ]; then
    echo "❌ Не удалось создать приложение за 5 попыток (портал упорно резолвится в standalone)."
    exit 1
  fi
  printf '%s' "$SID" > "$IDFILE"
fi

echo "→ 4/5  Жду сборку контейнера (status=running)…"
URL=""
for _ in $(seq 1 40); do
  INFO="$(api "$API/infra/servers/$SID")"
  ST="$(printf '%s' "$INFO" | field status)"
  case "$ST" in
    running)
      URL="$(printf '%s' "$INFO" | field appUrl)"
      [ -z "$URL" ] && URL="$(printf '%s' "$INFO" | grep -oE 'https://[a-z0-9.-]+\.vibecode\.bitrix24\.tech' | head -1)"
      break ;;
    error)
      echo; echo "❌ Сборка упала: $(printf '%s' "$INFO" | field provisionError)"
      echo "$INFO"; exit 1 ;;
  esac
  printf "."; sleep 6
done
echo

if [ -z "$URL" ]; then
  echo "⚠️  Не дождался running за ~4 мин. Проверь вручную:"
  echo "   curl -H \"X-Api-Key: \$VIBE_KEY\" $API/infra/servers/$SID"
  exit 1
fi

echo "→ 5/5  Делаю приложение публичным…"
api -X PATCH "$API/infra/servers/$SID/access-policy" \
    -H "Content-Type: application/json" -d '{"accessPolicy":"PUBLIC"}' >/dev/null

echo
echo "✅ Готово! Твой сайт онлайн:"
echo "   $URL"
