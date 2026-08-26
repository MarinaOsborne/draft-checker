export const MAX_RUNS = 3;
export const MAX_MONTHLY_RUNS = 412;

// Duplicated from src/constants.js — server/ can't import from src/ since
// the deploy archive (deploy/deploy.sh) never copies src/ into it, only
// server/ + dist/ + package.json.
export const LANGS = ["EN", "ES", "BR", "DE", "FR", "TR", "PL", "VN", "IT"];
