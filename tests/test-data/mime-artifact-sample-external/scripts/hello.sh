#!/usr/bin/env sh
# Hello world using conf/app-config.toml (MIME: text/x-shellscript)
set -eu
ROOT="${SQUADRULES_MIME_SAMPLE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
MSG="$(grep -E '^[[:space:]]*message[[:space:]]*=' "${ROOT}/conf/app-config.toml" | head -1 | sed -e 's/.*"\(.*\)".*/\1/')"
printf '%s\n' "${MSG:-missing message}"