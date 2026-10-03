#!/usr/bin/env sh
# squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
# Hello world using conf/app-config.toml (MIME: text/x-shellscript)
set -eu
ROOT="${KAIROS_MIME_SAMPLE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
MSG="$(grep -E '^[[:space:]]*message[[:space:]]*=' "${ROOT}/conf/app-config.toml" | head -1 | sed -e 's/.*"\(.*\)".*/\1/')"
printf '%s\n' "${MSG:-missing message}"