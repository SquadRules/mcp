#!/usr/bin/env bash
# Poll Valkey, Qdrant, Postgres, and Keycloak in parallel (used by integration CI).
set -euo pipefail

COMPOSE_PROJECT="${COMPOSE_PROJECT:-squadrules-mcp}"
ENV_FILE="${ENV_FILE:-.env}"
REDIS_PASSWORD_FROM_ENV="$(awk -F= '/^REDIS_PASSWORD=/{print $2}' "$ENV_FILE" | tail -n1)"

wait_valkey() {
  for i in $(seq 1 30); do
    if docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" --profile fullstack exec -T valkey \
      redis-cli -a "$REDIS_PASSWORD_FROM_ENV" ping 2>/dev/null | grep -q PONG; then
      return 0
    fi
    docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" --profile fullstack exec -T valkey \
      redis-cli ping 2>/dev/null | grep -q PONG && return 0
    [ "$i" -eq 30 ] && return 1
    sleep 2
  done
}

wait_qdrant() {
  for i in $(seq 1 30); do
    curl -sSf http://127.0.0.1:6333/healthz >/dev/null && return 0
    [ "$i" -eq 30 ] && return 1
    sleep 2
  done
}

wait_postgres() {
  for i in $(seq 1 30); do
    docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" --profile fullstack exec -T postgres \
      pg_isready -U keycloak -d keycloak 2>/dev/null && return 0
    [ "$i" -eq 30 ] && return 1
    sleep 2
  done
}

wait_keycloak() {
  for i in $(seq 1 90); do
    curl -sSf -o /dev/null http://localhost:9000/health/ready && return 0
    [ "$i" -eq 90 ] && return 1
    sleep 2
  done
}

wait_valkey &
p1=$!
wait_qdrant &
p2=$!
wait_postgres &
p3=$!
wait_keycloak &
p4=$!

ec=0
wait $p1 || ec=1
wait $p2 || ec=1
wait $p3 || ec=1
wait $p4 || ec=1

exit "$ec"
