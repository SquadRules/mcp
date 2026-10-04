#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"

npm_bin=${NPM_BIN:-npm}
log_dir=${AUDIT_LOG_DIR:-.local/npm-audit-fix}
fix_log="${log_dir}/audit-fix.txt"
after_standard_log="${log_dir}/audit-after-standard.txt"

mkdir -p "$log_dir"

write_mode() {
  printf 'mode=%s\n' "$1" >> "$GITHUB_OUTPUT"
}

set +e
"$npm_bin" audit fix 2>&1 | tee "$fix_log"
standard_status=${PIPESTATUS[0]}
set -e

force_needed=false
force_reason=""

if [ "$standard_status" -ne 0 ]; then
  if grep -Eq '(^|[^[:alnum:]_])ERESOLVE([^[:alnum:]_]|$)|npm audit fix --force' "$fix_log"; then
    force_needed=true
    force_reason="the standard fix could not resolve the dependency tree"
  else
    exit "$standard_status"
  fi
else
  set +e
  "$npm_bin" audit --omit=dev --audit-level=moderate 2>&1 | tee "$after_standard_log"
  audit_status=${PIPESTATUS[0]}
  set -e

  if [ "$audit_status" -eq 0 ]; then
    write_mode standard
    exit 0
  fi

  if grep -Fq 'npm audit fix --force' "$after_standard_log"; then
    force_needed=true
    force_reason="fixable moderate-or-higher production advisories remain after the standard fix"
  else
    echo "::error::Moderate-or-higher production advisories remain, but npm did not offer a force fix. Dev-tooling advisories are delegated to dependency tooling and must not be force-downgraded."
    exit "$audit_status"
  fi
fi

if [ "$force_needed" = true ]; then
  echo "${force_reason}; retrying with npm audit fix --omit=dev --force (production dependencies only)."
  dev_deps_before=""
  if [ -f package.json ]; then
    dev_deps_before=$(node -e 'console.log(JSON.stringify(require("./package.json").devDependencies||{}))')
  fi
  set +e
  "$npm_bin" audit fix --omit=dev --force 2>&1 | tee -a "$fix_log"
  force_status=${PIPESTATUS[0]}
  set -e
  [ "$force_status" -eq 0 ] || exit "$force_status"
  # Guard: a production-scoped force fix must never rewrite pinned dev tooling.
  if [ -f package.json ]; then
    dev_deps_after=$(node -e 'console.log(JSON.stringify(require("./package.json").devDependencies||{}))')
    if [ "$dev_deps_before" != "$dev_deps_after" ]; then
      echo "::error::Refusing to publish: the production force fix modified devDependencies (pinned tooling downgrade)."
      git checkout -- package.json package-lock.json 2>/dev/null || true
      exit 1
    fi
  fi
fi

"$npm_bin" audit --omit=dev --audit-level=moderate
write_mode force
