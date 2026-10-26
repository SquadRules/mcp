#!/usr/bin/env bash
# One-time setup + verify: build, realm config, login (browser), then search.
# Exit 0 only if "npm run cli -- search test" succeeds.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f .env ] && set -a && source .env && set +a
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
[[ "$KEYCLOAK_URL" =~ ^https?://keycloak: ]] && KEYCLOAK_URL="http://localhost:8080"
export KEYCLOAK_URL
# Preserve the retired `cli:dev` behaviour: default the API URL to the local server
# (`.env` was sourced above, so `npm run cli` inherits it).
export SQUADRULES_API_URL="${SQUADRULES_API_URL:-http://localhost:${SERVER_PORT:-3300}}"

if [ ! -f dist/cli/index.js ]; then
  npm run build
fi
if [ -n "${KEYCLOAK_ADMIN_PASSWORD:-}" ] && [ -f scripts/deploy-configure-keycloak-realms.py ]; then
  python3 scripts/deploy-configure-keycloak-realms.py
fi
echo "Complete login in the browser when it opens."
npm run cli -- login
out=$(npm run cli --silent -- search "test" 2>&1) || exit 1
echo "$out" | grep -q '"choices"' || exit 1
echo "OK"
exit 0
