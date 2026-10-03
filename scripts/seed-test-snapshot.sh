#!/usr/bin/env bash
# Seed test adapters and create Qdrant snapshot for CI/local test caching.
# Usage: npm run test:seed-snapshot
#
# This script:
# 1. Starts SQUADRULES with squadrules_ci collection (fresh Qdrant)
# 2. Trains all adapters needed for integration tests
# 3. Stops the app
# 4. Creates Qdrant snapshot
# 5. Caches snapshot:
#    - CI: GitHub Actions cache (workflow handles this)
#    - Local: .local/qdrant-snapshot/squadrules_ci.snapshot
#
# Snapshot is restored before tests to skip expensive train() calls.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_CACHE_DIR="${ROOT_DIR}/.local/qdrant-snapshot"
SNAPSHOT_FILE="${LOCAL_CACHE_DIR}/squadrules_ci.snapshot"
COLLECTION_NAME="${QDRANT_COLLECTION:-squadrules_ci}"

# Load environment from correct .env file
ENV="${ENV:-dev}"
if [ -f "${ROOT_DIR}/.env.${ENV}" ]; then
  set -a
  source "${ROOT_DIR}/.env.${ENV}"
  set +a
elif [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

# Use ALREADY RUNNING Qdrant and app (from current ENV)
# Do NOT start Qdrant binary - use the one from deploy-run-env.sh
QDRANT_URL="${QDRANT_URL:-http://127.0.0.1:6333}"
QDRANT_API_KEY="${QDRANT_API_KEY:-}"
APP_PORT="${PORT:-3300}"
APP_URL="http://localhost:${APP_PORT}"
MCP_URL="${APP_URL}/mcp"

# Headers for Qdrant API
QDRANT_HEADERS=()
if [[ -n "${QDRANT_API_KEY}" ]]; then
  QDRANT_HEADERS=("-H" "api-key: ${QDRANT_API_KEY}")
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
  printf "${BLUE}[seed]${NC} %s\n" "$1"
}

log_success() {
  printf "${GREEN}[seed]${NC} ✅ %s\n" "$1"
}

log_warn() {
  printf "${YELLOW}[seed]${NC} ⚠️  %s\n" "$1"
}

log_error() {
  printf "${RED}[seed]${NC} ❌ %s\n" "$1" >&2
}

# No cleanup needed - using already running services

# Step 0: Clean previous snapshot
log_info "Cleaning previous snapshot..."
rm -f "${SNAPSHOT_FILE}"
mkdir -p "${LOCAL_CACHE_DIR}"

# Use ALREADY RUNNING Qdrant and app from deploy-run-env.sh
log_info "Using Qdrant at: ${QDRANT_URL}"
log_info "Using SQUADRULES app at: ${APP_URL}"

# Verify Qdrant is running
if ! curl -sSf "${QDRANT_URL}/healthz" >/dev/null 2>&1; then
  log_error "Qdrant not running at ${QDRANT_URL}"
  log_error "Run: npm run dev:deploy (or npm run dev_simple:deploy)"
  exit 1
fi

# Verify SQUADRULES app is running
if ! curl -sSf "${APP_URL}/health" >/dev/null 2>&1; then
  log_error "SQUADRULES app not running at ${APP_URL}"
  log_error "Run: npm run dev:deploy (or npm run dev_simple:deploy)"
  exit 1
fi

log_success "Services are running"

# Step 3: Train test adapters using MCP tools
log_info "Training test adapters..."

# Helper function to call MCP tool
call_mcp_tool() {
  local tool_name="$1"
  local arguments="$2"
  
  local response
  response=$(curl -sSf -X POST "${MCP_URL}" \
    -H "Content-Type: application/json" \
    -H "MCP-Protocol-Version: 2024-11-05" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": 1,
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"${tool_name}\",
        \"arguments\": ${arguments}
      }
    }")
  
  echo "${response}"
}

# Train AI_CODING_RULES adapter using SQUADRULES CLI (handles auth automatically)
log_info "Training AI_CODING_RULES adapter via CLI..."

# Create temporary directory with test adapter markdown
TEMP_DIR=$(mktemp -d)
cp "${ROOT_DIR}/tests/test-data/AI_CODING_RULES.md" "${TEMP_DIR}/"

log_info "Training from: ${TEMP_DIR}"
log_info "Base URL: ${APP_URL}"

# Train using SQUADRULES CLI (uses stored auth from squadrules login)
TRAIN_OUTPUT=$(node "${ROOT_DIR}/dist/cli/index.js" train --url "${APP_URL}" --force "${TEMP_DIR}" 2>&1)
TRAIN_EXIT=$?

# Cleanup temp dir
rm -rf "${TEMP_DIR}"

if [ ${TRAIN_EXIT} -eq 0 ] && echo "${TRAIN_OUTPUT}" | grep -q '"status".*"stored"'; then
  log_success "AI_CODING_RULES adapter trained"
  echo "${TRAIN_OUTPUT}" | tail -3
else
  log_error "Failed to train AI_CODING_RULES adapter"
  echo "${TRAIN_OUTPUT}"
  exit 1
fi

# Add additional adapters here as needed
# Example: train other test adapters
# log_info "Training additional test adapter..."
# TRAIN_RESPONSE=$(call_mcp_tool "train" "{...}")

# Small delay to ensure vectors are indexed
log_info "Waiting for vector indexing to complete..."
sleep 3

# Note: Do NOT stop the app - we're using the already running instance from deploy-run-env.sh
log_info "Adapter training complete - app remains running for snapshot creation"

# Step 5: Create Qdrant snapshot (both main collection and traces)
log_info "Creating Qdrant snapshots..."

# Snapshot main collection
log_info "Snapshotting collection: ${COLLECTION_NAME}"
SNAPSHOT_CREATE_RESPONSE=$(curl -sSf -X POST "${QDRANT_URL}/collections/${COLLECTION_NAME}/snapshots" \
  -H "Content-Type: application/json" \
  "${QDRANT_HEADERS[@]}" \
  -d '{"wait": true}')

SNAPSHOT_NAME=$(echo "${SNAPSHOT_CREATE_RESPONSE}" | python3 -c '
import sys, json
data = json.load(sys.stdin)
result = data.get("result", {})
print(result.get("name", ""))
')

if [[ -z "${SNAPSHOT_NAME}" ]]; then
  log_error "Failed to create main snapshot"
  echo "${SNAPSHOT_CREATE_RESPONSE}" | python3 -m json.tool || echo "${SNAPSHOT_CREATE_RESPONSE}"
  exit 1
fi

log_success "Main collection snapshot created: ${SNAPSHOT_NAME}"

# Download main snapshot
curl -sSf -o "${SNAPSHOT_FILE}" \
  "${QDRANT_URL}/collections/${COLLECTION_NAME}/snapshots/${SNAPSHOT_NAME}" \
  "${QDRANT_HEADERS[@]}"

SNAPSHOT_SIZE=$(wc -c < "${SNAPSHOT_FILE}" | tr -d ' ')
log_success "Main snapshot downloaded: ${SNAPSHOT_FILE} (${SNAPSHOT_SIZE} bytes)"

# Snapshot traces collection
TRACES_COLLECTION="${COLLECTION_NAME}_traces"
log_info "Snapshotting traces collection: ${TRACES_COLLECTION}"

# Check if traces collection exists
if curl -sSf "${QDRANT_URL}/collections/${TRACES_COLLECTION}" "${QDRANT_HEADERS[@]}" >/dev/null 2>&1; then
  TRACES_SNAPSHOT_RESPONSE=$(curl -sSf -X POST "${QDRANT_URL}/collections/${TRACES_COLLECTION}/snapshots" \
    -H "Content-Type: application/json" \
    "${QDRANT_HEADERS[@]}" \
    -d '{"wait": true}')
  
  TRACES_SNAPSHOT_NAME=$(echo "${TRACES_SNAPSHOT_RESPONSE}" | python3 -c '
import sys, json
data = json.load(sys.stdin)
result = data.get("result", {})
print(result.get("name", ""))
' 2>/dev/null)
  
  if [ -n "${TRACES_SNAPSHOT_NAME}" ]; then
    TRACES_SNAPSHOT_FILE="${LOCAL_CACHE_DIR}/squadrules_ci_traces.snapshot"
    curl -sSf -o "${TRACES_SNAPSHOT_FILE}" \
      "${QDRANT_URL}/collections/${TRACES_COLLECTION}/snapshots/${TRACES_SNAPSHOT_NAME}" \
      "${QDRANT_HEADERS[@]}"
    
    TRACES_SIZE=$(wc -c < "${TRACES_SNAPSHOT_FILE}" | tr -d ' ')
    log_success "Traces snapshot downloaded: ${TRACES_SNAPSHOT_FILE} (${TRACES_SIZE} bytes)"
  else
    log_warning "Traces snapshot creation failed or empty"
  fi
else
  log_info "Traces collection does not exist yet (will be created on first execution)"
fi

# Step 7: Verify snapshot
log_info "Verifying snapshot integrity..."
if [[ ${SNAPSHOT_SIZE} -lt 100 ]]; then
  log_error "Snapshot file too small (${SNAPSHOT_SIZE} bytes) - likely corrupted"
  exit 1
fi

log_success "Snapshot verification passed"

# Step 8: Print summary
log_info "========================================="
log_success "Snapshot seed completed successfully!"
log_info "========================================="
log_info "Snapshot location: ${SNAPSHOT_FILE}"
log_info "Snapshot size: ${SNAPSHOT_SIZE} bytes"
log_info "Collection name: ${COLLECTION_NAME}"
log_info ""
log_info "Cache location: .local/qdrant-snapshot/"
log_info "  - Local tests: automatically restored from .local/"
log_info "  - CI: GitHub Actions cache (workflow handles upload)"
log_info ""
log_info "Next steps:"
log_info "1. Run tests: npm run dev_simple:test"
log_info "2. Tests will auto-restore snapshot from .local/ cache"
log_info "========================================="

exit 0
