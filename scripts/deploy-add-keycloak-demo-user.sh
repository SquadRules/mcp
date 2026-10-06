#!/usr/bin/env bash
# Add a demo user to Keycloak realm squadrules-dev using the Admin CLI (kcadm.sh) inside the container.
# Requires: Keycloak running (docker compose -p squadrules-mcp --env-file .env --profile fullstack up -d).
#
# Usage:
#   ./scripts/deploy-add-keycloak-demo-user.sh
#   DEMO_PASSWORD=mysecret ./scripts/deploy-add-keycloak-demo-user.sh
#
# Reads KEYCLOAK_ADMIN_PASSWORD from .env. Creates user "demo" in squadrules-dev
# with password from DEMO_PASSWORD (default: demo).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Load admin password from .env
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT_DIR/.env"
  set +a
fi

if [ -z "${KEYCLOAK_ADMIN_PASSWORD:-}" ]; then
  echo "ERROR: KEYCLOAK_ADMIN_PASSWORD not set. Add it to .env and run again." >&2
  exit 1
fi

DEMO_USER="${DEMO_USER:-demo}"
DEMO_PASSWORD="${DEMO_PASSWORD:-demo}"
REALM="${REALM:-squadrules-dev}"

# Resolve Keycloak container (compose project from ROOT_DIR)
CONTAINER=$(docker compose -p squadrules-mcp --env-file .env -f compose/infra.yaml ps -q keycloak 2>/dev/null || true)
if [ -z "$CONTAINER" ]; then
  echo "ERROR: Keycloak container not running. Start with: docker compose -p squadrules-mcp --env-file .env -f compose/infra.yaml --profile fullstack up -d" >&2
  exit 1
fi

echo "Adding demo user '$DEMO_USER' to realm '$REALM' (container: $CONTAINER)..."

docker exec \
  -e KEYCLOAK_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_PASSWORD" \
  -e DEMO_PASSWORD="$DEMO_PASSWORD" \
  -e DEMO_USER="$DEMO_USER" \
  -e REALM="$REALM" \
  "$CONTAINER" /bin/bash -c '
  /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password "$KEYCLOAK_ADMIN_PASSWORD" && \
  /opt/keycloak/bin/kcadm.sh create users -r "$REALM" -s username="$DEMO_USER" -s enabled=true 2>/dev/null || true && \
  /opt/keycloak/bin/kcadm.sh set-password -r "$REALM" --username "$DEMO_USER" --new-password "$DEMO_PASSWORD"
'

echo "Done. Demo user: $DEMO_USER / $DEMO_PASSWORD (realm: $REALM, Admin UI: http://localhost:8080)"
