#!/bin/sh
# DEPRECATED: Docker stdio entrypoint (copied in by Dockerfile.stdio only). @squadrules/mcp
# is an npm-only package; container images build in SquadRules/containers from the published
# npm package, and `npx @squadrules/mcp serve` needs no OPENAI_API_KEY (local fastembed is the
# default). Retained for reference pending Docker cleanup; do not extend.
set -eu

if [ -z "${OPENAI_API_KEY:-}" ]; then
  printf '%s\n' "OPENAI_API_KEY must be set" >&2
  exit 1
fi

export TRANSPORT_TYPE=stdio
export AUTH_ENABLED=false

qdrant 1>&2 &
qdrant_pid=$!

tries=120
while [ $tries -gt 0 ]; do
  if curl -fsS "http://127.0.0.1:6333/readyz" >/dev/null 2>&1; then
    break
  fi
  tries=$((tries - 1))
  sleep 0.25
done

if [ $tries -le 0 ]; then
  kill "$qdrant_pid" >/dev/null 2>&1 || true
  printf '%s\n' "Qdrant did not become ready" >&2
  exit 1
fi

node /app/node_modules/@squadrules/mcp/dist/bootstrap.js
exit_code=$?

kill "$qdrant_pid" >/dev/null 2>&1 || true
wait "$qdrant_pid" >/dev/null 2>&1 || true

exit "$exit_code"
