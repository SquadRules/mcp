#!/usr/bin/env bash
#
# Import Qdrant test snapshot
# Called by deploy-run-env.sh after health check when CI=true
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOT_FILE="${ROOT_DIR}/.local/qdrant-snapshot/squadrules_ci.snapshot"

# Load environment from correct .env file
ENV="${ENV:-dev_simple}"
if [ -f "${ROOT_DIR}/.env.${ENV}" ]; then
  set -a
  source "${ROOT_DIR}/.env.${ENV}"
  set +a
elif [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

# Qdrant config (from .env)
QDRANT_URL="${QDRANT_URL:-http://127.0.0.1:6333}"
QDRANT_API_KEY="${QDRANT_API_KEY:-}"
COLLECTION_NAME="${QDRANT_COLLECTION:-squadrules_ci}"

# Headers for Qdrant API
CURL_HEADERS=("-H" "Content-Type: application/json")
if [[ -n "${QDRANT_API_KEY}" ]]; then
  CURL_HEADERS+=("-H" "api-key: ${QDRANT_API_KEY}")
fi

log_info() { echo "[INFO] $1"; }
log_success() { echo "[SUCCESS] $1"; }
log_error() { echo "[ERROR] $1" >&2; }

log_info "Importing Qdrant snapshot: ${SNAPSHOT_FILE}"

# Check if snapshot exists, seed if missing (local dev only)
if [[ ! -f "${SNAPSHOT_FILE}" ]]; then
  if [[ "${CI:-}" != "true" ]]; then
    log_error "Snapshot not found: ${SNAPSHOT_FILE}"
    log_error "Run: npm run test:seed-snapshot"
    exit 1
  fi
  
  # CI mode: auto-seed the snapshot
  log_info "Snapshot not found in CI - generating seed..."
  SEED_SCRIPT="${ROOT_DIR}/scripts/seed-test-snapshot.sh"
  if [[ ! -f "${SEED_SCRIPT}" ]]; then
    log_error "Seed script not found: ${SEED_SCRIPT}"
    exit 1
  fi
  
  log_info "Running seed script (this may take 10-30s)..."
  if bash "${SEED_SCRIPT}"; then
    log_success "Snapshot seeded successfully"
  else
    log_error "Snapshot seeding failed"
    exit 1
  fi
  
  # Verify snapshot was created
  if [[ ! -f "${SNAPSHOT_FILE}" ]]; then
    log_error "Seed script completed but snapshot not found"
    exit 1
  fi
fi

# Check if Qdrant is healthy
if ! curl -sf "${QDRANT_URL}/healthz" > /dev/null; then
  log_error "Qdrant is not healthy at ${QDRANT_URL}"
  exit 1
fi

# Drop existing collections (if exist)
log_info "Dropping collections (if exist)..."
curl -sf -X DELETE \
  "${QDRANT_URL}/collections/${COLLECTION_NAME}" \
  "${CURL_HEADERS[@]}" \
  || true  # Ignore error if collection doesn't exist

curl -sf -X DELETE \
  "${QDRANT_URL}/collections/${COLLECTION_NAME}_traces" \
  "${CURL_HEADERS[@]}" \
  || true  # Ignore error if traces collection doesn't exist

# Do NOT create collection manually - snapshot restore will create it with correct multi-vector schema
log_info "Restoring main collection from snapshot..."
# Note: Do NOT send Content-Type header with -F (curl sets multipart/form-data automatically)
UPLOAD_HEADERS=()
if [[ -n "${QDRANT_API_KEY}" ]]; then
  UPLOAD_HEADERS=("-H" "api-key: ${QDRANT_API_KEY}")
fi

UPLOAD_RESPONSE=$(curl -sS -X POST \
  "${QDRANT_URL}/collections/${COLLECTION_NAME}/snapshots/upload" \
  "${UPLOAD_HEADERS[@]}" \
  -F "snapshot=@${SNAPSHOT_FILE}" \
  -F "priority=low" 2>&1)

UPLOAD_EXIT=$?
if [ ${UPLOAD_EXIT} -ne 0 ]; then
  log_error "Failed to upload main snapshot (exit code: ${UPLOAD_EXIT})"
  echo "${UPLOAD_RESPONSE}"
  exit 1
fi

# Check if response indicates success
if echo "${UPLOAD_RESPONSE}" | python3 -c 'import sys, json; data = json.load(sys.stdin); assert data.get("status") == "ok"' 2>/dev/null; then
  log_success "Main snapshot imported successfully"
else
  log_error "Main snapshot upload failed"
  echo "${UPLOAD_RESPONSE}"
  exit 1
fi

# Import traces snapshot if it exists
TRACES_SNAPSHOT_FILE="${ROOT_DIR}/.local/qdrant-snapshot/squadrules_ci_traces.snapshot"
if [ -f "${TRACES_SNAPSHOT_FILE}" ]; then
  log_info "Restoring traces collection from snapshot..."
  # Do NOT create collection - snapshot will create it with correct schema
  
  log_info "Uploading traces snapshot to Qdrant..."
  # Note: Do NOT send Content-Type header with -F
  TRACES_UPLOAD_RESPONSE=$(curl -sS -X POST \
    "${QDRANT_URL}/collections/${COLLECTION_NAME}_traces/snapshots/upload" \
    "${UPLOAD_HEADERS[@]}" \
    -F "snapshot=@${TRACES_SNAPSHOT_FILE}" \
    -F "priority=low" 2>&1)
  
  log_success "Traces snapshot imported successfully"
else
  log_info "No traces snapshot found (will be created on first execution)"
fi

# Wait for snapshot to be processed
log_info "Waiting for snapshot import to complete..."
sleep 3

# Verify collection has data
POINT_COUNT=$(curl -sf \
  "${QDRANT_URL}/collections/${COLLECTION_NAME}" \
  "${CURL_HEADERS[@]}" | \
  node -e "
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => {
      const data = JSON.parse(Buffer.concat(chunks).toString());
      console.log(data.result.points_count || 0);
    });
  ")

if [[ "${POINT_COUNT}" -gt 0 ]]; then
  log_success "Snapshot imported successfully"
  log_info "Collection '${COLLECTION_NAME}' has ${POINT_COUNT} points"
else
  log_error "Collection is empty after import"
  exit 1
fi
