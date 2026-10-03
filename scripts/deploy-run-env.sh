#!/usr/bin/env bash
# squadrules-compat-surface: uses persisted Qdrant collection names (kairos / kairos_memories / kairos_ci / kairos_simple_ci); renaming would orphan existing vectors
# kairos Environment Management Script
# USAGE: ENV=dev|dev_simple|dev_stdio|prod ./scripts/deploy-run-env.sh [build|start|stop|restart|status|test|logs|health|...]
#
# Single base .env plus optional .env.<ENV> profile overrides; prod is not managed from this repo
# (exception: Keycloak realm setup dev/prod).
# - dev:        Local app (start, stop, test, build). SERVER_PORT=3300 default. PID/log: .kairos-dev.*
# - dev_simple: Local app simple mode profile (auth off, isolated ports). PID/log: .kairos-dev_simple.*
# - dev_stdio: Local app stdio profile (auth off; TRANSPORT_TYPE=stdio; no HTTP app). PID/log: .kairos-dev_stdio.*
# - prod: Inspect-only when .env points at prod (health, status, qdrant-curl, redis-cli, logs). App managed elsewhere.
#
# For AI agents: Use as black box. Reports MCP server URL and service status.

# Dependencies:
# - jq:           sudo apt-get install jq   # For JSON formatting in health checks
# - curl:         sudo apt-get install curl
# - docker-compose: sudo apt-get install docker-compose
# - redis-cli:    sudo apt-get install redis-tools
# - pipx (optional): sudo apt-get install pipx

# Check if this is ensure-coding-rules command (doesn't need ENV)
FIRST_ARG="${1:-}"
if [ "$FIRST_ARG" = "ensure-coding-rules" ] && [ -z "${ENV+x}" ]; then
    # Allow ensure-coding-rules to run without ENV
    ENV="${ENV:-dev}"  # Set a default for variable references, but won't be used
fi

if [ -z "${ENV+x}" ] && [ "$FIRST_ARG" != "ensure-coding-rules" ]; then
    echo "!!! Do NOT run this script directly !!!"
    echo ""
    echo "Use npm scripts instead. Common targets include:"
    echo "  - npm run dev:start    (start development environment)"
    echo "  - npm run dev:test     (run tests in development)"
    echo ""
    echo "See package.json for the full list of available npm scripts."
    exit 1
fi

set -euo pipefail

set +a

# set -o xtrace

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
mask_url() {
    local url="${1:-}"
    if [[ -z "$url" ]]; then
        echo ""
        return
    fi
    printf '%s' "$url" | sed -E 's#(://)[^@/]+@#\1***@#'
}

# Environment setup (single .env for all)
ENV="${ENV:-dev}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_ENV_FILE="${PROJECT_DIR}/.env"
PROFILE_ENV_FILE="${PROJECT_DIR}/.env.${ENV}"
if [ -f "$PROFILE_ENV_FILE" ]; then
    ENV_FILE="$PROFILE_ENV_FILE"
else
    ENV_FILE="$BASE_ENV_FILE"
fi
PID_FILE="${PROJECT_DIR}/.kairos-${ENV}.pid"
LOG_FILE="${PROJECT_DIR}/.kairos-${ENV}.log"

# In a git worktree, .env* are not shared: copy from main worktree if missing (no-op in main worktree)
if [ "$FIRST_ARG" != "ensure-coding-rules" ] && [ ! -f "$BASE_ENV_FILE" ]; then
    if [ -f "${PROJECT_DIR}/scripts/deploy-copy-env-from-main.sh" ]; then
        "${PROJECT_DIR}/scripts/deploy-copy-env-from-main.sh" || true
    fi
fi

# Load environment (skip if ensure-coding-rules doesn't need it)
# Preserve AUTH_ENABLED if explicitly set (e.g. AUTH_ENABLED=true npm run dev:test)
if [ "$FIRST_ARG" != "ensure-coding-rules" ]; then
    AUTH_ENABLED_BEFORE="${AUTH_ENABLED:-}"
    [ -f "$BASE_ENV_FILE" ] && set -a && source "$BASE_ENV_FILE" && set +a
    [ -f "$PROFILE_ENV_FILE" ] && set -a && source "$PROFILE_ENV_FILE" && set +a
    [ -n "${AUTH_ENABLED_BEFORE}" ] && export AUTH_ENABLED="$AUTH_ENABLED_BEFORE"
fi

# Validate environment (skip for ensure-coding-rules)
if [ "$FIRST_ARG" != "ensure-coding-rules" ]; then
    case "$ENV" in dev|dev_simple|dev_stdio|prod) ;; *) print_error "Invalid ENV: $ENV (use dev, dev_simple, dev_stdio, or prod)"; exit 1 ;; esac
fi

# Environment defaults (SERVER_PORT from .env/.env.<ENV>; dev=3300, dev_simple/dev_stdio=4300, prod=3500 for inspect)
if [ "$FIRST_ARG" != "ensure-coding-rules" ]; then
    case "$ENV" in
        dev)
            SERVER_PORT="${SERVER_PORT:-3300}"
            METRICS_PORT="${METRICS_PORT:-9390}"
            ;;
        dev_simple|dev_stdio)
            SERVER_PORT="${SERVER_PORT:-4300}"
            METRICS_PORT="${METRICS_PORT:-9490}"
            QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
            ;;
        prod)
            SERVER_PORT="${SERVER_PORT:-3500}"
            METRICS_PORT="${METRICS_PORT:-9390}"
            ;;
    esac
fi

# Health checks
check_qdrant() {
    local url="${QDRANT_URL:-http://localhost:6333}"
    url=${url%/}/healthz
    if [[ -n "${QDRANT_API_KEY:-}" ]]; then
        curl -s -H "api-key: ${QDRANT_API_KEY}" "$url" >/dev/null 2>&1 \
            && print_success "Qdrant OK (auth)" \
            || print_warning "Qdrant DOWN (auth?)"
    else
        curl -s "$url" >/dev/null 2>&1 \
            && print_success "Qdrant OK" \
            || print_warning "Qdrant DOWN (set QDRANT_API_KEY if required)"
    fi
}
check_redis() {
    local redis_url="${REDIS_URL:-}"
    if [[ -z "$redis_url" ]]; then
        print_info "Redis check skipped (REDIS_URL not set)"
        return 0
    fi
    redis-cli -u "$redis_url" ping >/dev/null 2>&1 && print_success "Redis OK" || print_warning "Redis DOWN"
}
check_tei() { 
    # Skip TEI check if using OpenAI embeddings
    if [[ "${EMBEDDING_PROVIDER:-}" == "openai" ]] || [[ -n "${OPENAI_API_KEY:-}" && -z "${TEI_BASE_URL:-}" ]]; then
        return 0  # Skip check when using OpenAI
    fi
    curl -s "${TEI_BASE_URL:-http://localhost:8080}/health" >/dev/null 2>&1 && print_success "TEI OK" || print_warning "TEI DOWN"
}
check_metrics() {
    curl -s "http://localhost:${METRICS_PORT}/health" >/dev/null 2>&1 \
        && print_success "Metrics OK (port ${METRICS_PORT})" \
        || print_warning "Metrics DOWN (port ${METRICS_PORT})"
}

ensure_runtime_dirs() {
    # Create baseline local runtime root when using in-repo defaults.
    mkdir -p "$PROJECT_DIR/.local"

    # Ensure snapshot directory exists when configured (supports absolute and project-relative paths).
    if [[ -n "${QDRANT_SNAPSHOT_DIR:-}" ]]; then
        if [[ "${QDRANT_SNAPSHOT_DIR}" = /* ]]; then
            mkdir -p "${QDRANT_SNAPSHOT_DIR}"
        else
            mkdir -p "${PROJECT_DIR}/${QDRANT_SNAPSHOT_DIR}"
        fi
    fi
}

# URLs overview per environment
show_urls() {
    local base="http://localhost:${SERVER_PORT:-0}"
    print_info "Endpoints and dependencies (ENV=$ENV):"

    # App endpoints (grouped)
    echo "- App:"
    echo "  · Root:   ${base}/"
    echo "  · Health: ${base}/health"
    echo "  · MCP:    ${base}/mcp"

    # Dependencies
    local qdrant="${QDRANT_URL:-http://localhost:6333}"
    qdrant=${qdrant%/}
    local tei="${TEI_BASE_URL:-http://localhost:8080}"
    tei=${tei%/}

    # Qdrant (nicely grouped like Redis)
    local qkey_msg="not set"
    if [[ -n "${QDRANT_API_KEY:-}" ]]; then qkey_msg="set"; fi
    echo "- Qdrant:"
    echo "  · URL:       ${qdrant}"
    echo "  · Health:    ${qdrant}/healthz"
    echo "  · Collection: ${QDRANT_COLLECTION:-kairos}"
    echo "  · API key:   ${qkey_msg} (env: \$QDRANT_API_KEY)"

    # TEI (only if not using OpenAI embeddings)
    if [[ "${EMBEDDING_PROVIDER:-}" != "openai" ]] && [[ -z "${OPENAI_API_KEY:-}" || -n "${TEI_BASE_URL:-}" ]]; then
        echo "- TEI:"
        echo "  · URL:    ${tei}"
        echo "  · Health: ${tei}/health"
    fi

    # Redis
    if [[ -n "${REDIS_URL:-}" ]]; then
        echo "- Redis:   via redis-cli (no HTTP)"
        echo "  · URL:        $(mask_url "${REDIS_URL}")"
        echo "  · Key prefix: ${KAIROS_REDIS_PREFIX:-kb:}"
    else
        echo "- Redis:   disabled (REDIS_URL not set)"
    fi

    # Metrics
    echo "- Metrics:"
    echo "  · URL:    http://localhost:${METRICS_PORT}"
    echo "  · Health: http://localhost:${METRICS_PORT}/health"
    echo "  · Metrics: http://localhost:${METRICS_PORT}/metrics"
}

# Core operations
build() {
    print_info "Building project..."
    cd "$PROJECT_DIR"
    case "$ENV" in
        dev|dev_simple|dev_stdio|prod)
            print_info "Running prebuild (embed-docs) and verification..."
            npm run prebuild
            npx tsc && chmod +x dist/cli/index.js && print_success "Build complete"
            ;;
    esac
}

start() {
    print_info "Starting $ENV environment..."
    cd "$PROJECT_DIR"
    ensure_runtime_dirs

    # Logging configuration
    LOG_TARGET="${LOG_TARGET:-file}"
    LOG_LEVEL="${LOG_LEVEL:-info}"
    LOG_FORMAT="${LOG_FORMAT:-text}"

    case "$ENV" in
        dev|dev_simple|dev_stdio)
            # Validate LOG_TARGET
            case "$LOG_TARGET" in
                file|stdout|both) ;;
                *) print_error "Invalid LOG_TARGET: $LOG_TARGET (use file, stdout, or both)"; exit 1 ;;
            esac

            if [ "$ENV" = "dev_simple" ]; then
                qdrant_url="${QDRANT_URL:-http://localhost:7633}"
                qdrant_hostport="${qdrant_url#*://}"
                qdrant_hostport="${qdrant_hostport%%/*}"
                qdrant_host="${qdrant_hostport%%:*}"
                if [[ "${qdrant_hostport}" == *:* ]]; then
                    qdrant_port="${qdrant_hostport##*:}"
                else
                    qdrant_port="7633"
                fi
                qdrant_grpc_port="$((qdrant_port + 1))"
                print_info "Ensuring Qdrant binary is running (${qdrant_url})..."
                bash "$PROJECT_DIR/scripts/qdrant-binary.sh" install
                
                # Idempotent start: check if port is already in use
                existing_pid=$(lsof -ti :${qdrant_port} 2>/dev/null || true)
                if [ -n "$existing_pid" ]; then
                    print_info "Port ${qdrant_port} in use by PID ${existing_pid}, checking health..."
                    # Check if existing Qdrant is healthy
                    if curl -sSf "${qdrant_url}/healthz" >/dev/null 2>&1; then
                        print_success "Qdrant already running and healthy on port ${qdrant_port} (PID ${existing_pid})"
                    else
                        print_warning "Port ${qdrant_port} occupied but Qdrant not healthy, killing PID ${existing_pid}..."
                        kill -9 "$existing_pid" 2>/dev/null || true
                        sleep 2
                        QDRANT_HOST="${qdrant_host}" QDRANT_HTTP_PORT="${qdrant_port}" QDRANT_GRPC_PORT="${qdrant_grpc_port}" bash "$PROJECT_DIR/scripts/qdrant-binary.sh" start
                    fi
                else
                    print_info "Starting Qdrant binary on port ${qdrant_port}..."
                    QDRANT_HOST="${qdrant_host}" QDRANT_HTTP_PORT="${qdrant_port}" QDRANT_GRPC_PORT="${qdrant_grpc_port}" bash "$PROJECT_DIR/scripts/qdrant-binary.sh" start
                fi
            fi

            # Start the dev server with env from .env (CI and local).
            # Use 'env VAR=...' after dotenv so MAX_CONCURRENT_MCP_REQUESTS from .env is visible to node (dotenv -e can override inherited env).
            # For E2E and CLI browser login, well-known must expose a URL the browser can open. If .env has KEYCLOAK_URL with internal host (e.g. keycloak:8080), override for the dev process.
            keycloak_export=""
            if [ "$ENV" = "dev" ] && [[ "${KEYCLOAK_URL:-}" =~ ^https?://keycloak: ]]; then
                keycloak_export="KEYCLOAK_URL=http://localhost:8080"
            fi
            dev_port="${SERVER_PORT:-3300}"
            mcpr="${MAX_CONCURRENT_MCP_REQUESTS:-}"
            # Use compiled dist/bootstrap.js when available (avoids ts-node loader crash on Node 25)
            if [ -f "$PROJECT_DIR/dist/bootstrap.js" ]; then
                dev_cmd="LOG_LEVEL=debug npx -y dotenv -e $ENV_FILE -- env $keycloak_export ${mcpr:+MAX_CONCURRENT_MCP_REQUESTS=\"$mcpr\"} node dist/bootstrap.js"
            else
                dev_cmd="LOG_LEVEL=debug npx -y dotenv -e $ENV_FILE -- env $keycloak_export ${mcpr:+MAX_CONCURRENT_MCP_REQUESTS=\"$mcpr\"} node --loader ts-node/esm src/bootstrap.ts"
            fi
            case "$LOG_TARGET" in
                file)
                    eval "$dev_cmd" > "$LOG_FILE" 2>&1 &
                    ;;
                stdout)
                    eval "$dev_cmd" &
                    ;;
                both)
                    eval "$dev_cmd" > >(tee "$LOG_FILE") 2>&1 &
                    ;;
            esac

            # Resolve actual dev server PID:
            # - stdio mode: use background PID directly (no HTTP listener expected)
            # - http mode: prefer listener PID by port
            if [[ "${TRANSPORT_TYPE:-http}" == "stdio" ]]; then
                dev_pid="$!"
                echo "$dev_pid" > "$PID_FILE"
                print_success "Dev stdio server started (PID: $dev_pid)"
            else
                if command -v lsof >/dev/null 2>&1; then
                    # Give the server a moment to bind to the port
                    sleep 1
                    dev_pid="$(lsof -ti :"${dev_port}" 2>/dev/null | head -n1 || true)"
                    if [ -n "${dev_pid:-}" ]; then
                        echo "$dev_pid" > "$PID_FILE"
                        print_success "Dev server listening on port ${dev_port} (PID: $dev_pid)"
                    else
                        print_warning "Dev server started but not yet bound to port ${dev_port}; PID file not created (no listener on ${dev_port} yet)"
                    fi
                else
                    print_error "lsof not available; cannot determine dev server PID (PID file not created)"
                fi
            fi

            if [[ "${TRANSPORT_TYPE:-http}" == "stdio" ]]; then
                print_info "STDIO mode enabled: no HTTP listeners (app or metrics)."
                check_qdrant
                check_redis
            else
                show_urls
            fi

            ;;
        prod)
            print_info "Prod is not started from this script; use your deployment pipeline."
            ;;
    esac
    # Health check after server startup with retries (skip for prod/stdio mode)
    if [ "$ENV" != "prod" ] && [[ "${TRANSPORT_TYPE:-http}" != "stdio" ]]; then
        ATTEMPTS="${HEALTH_CHECK_ATTEMPTS:-30}"
        print_info "Performing post-startup health check with retries..."
        attempt=1
        while [ $attempt -le $ATTEMPTS ]; do
            print_info "Health check attempt $attempt/$ATTEMPTS..."
            health_body="$(curl -fsS "http://localhost:${SERVER_PORT}/health" 2>/dev/null || true)"
            if [[ -n "$health_body" ]] && [[ "$health_body" == *'"status":"healthy"'* ]]; then
                print_success "Server health check passed on attempt $attempt"
                break
            else
                if [ $attempt -eq $ATTEMPTS ]; then
                    if [[ -n "$health_body" ]]; then
                        print_error "Last /health response: $health_body"
                    fi
                    print_error "Server health check failed after $ATTEMPTS attempts"
                    exit 1
                fi
                sleep 2
            fi
            attempt=$((attempt + 1))
        done
        
        # Import test snapshot if CI=true (for integration tests)
        if [ "${CI:-}" = "true" ]; then
            if  [ ! -f ".local/qdrant-snapshot/kairos_ci.snapshot" ]; then
                # Only auto-seed in dev_simple mode (no auth)
                # Dev mode requires manual seed with auth: npm run test:seed-snapshot
                if [ "$ENV" = "dev_simple" ]; then
                    print_info "CI mode detected - creating Qdrant test snapshot (ENV=${ENV})..."
                    if bash "$PROJECT_DIR/scripts/seed-test-snapshot.sh"; then
                        print_success "Test snapshot exported successfully"
                    else
                        print_error "Test snapshot export failed - tests will fail"
                    fi
                else
                    print_warning "Snapshot missing in dev mode - run manually: npm run test:seed-snapshot"
                fi
            fi

            print_info "CI mode detected - importing Qdrant test snapshot..."
            if bash "$PROJECT_DIR/scripts/import-test-snapshot.sh"; then
                print_success "Test snapshot imported successfully"
            else
                print_warning "Test snapshot import failed - tests may fail"
            fi
        fi
    fi
    # Dev: ensure Keycloak has kairos-dev realm and kairos-cli client so "npm run cli:dev -- login" works
    if [ "$ENV" = "dev" ]; then
        print_info "Ensuring Keycloak realm and kairos-cli client..."
        if ( cd "$PROJECT_DIR" && python3 scripts/deploy-configure-keycloak-realms.py ); then
            print_success "Keycloak realm configured (kairos-cli client ready for CLI login)"
        else
            print_warning "Keycloak realm config failed or Keycloak not reachable. If you use auth, run: python3 scripts/deploy-configure-keycloak-realms.py or npm run infra:up"
        fi
    fi
}

stop() {
    print_info "Stopping $ENV environment..."
    cd "$PROJECT_DIR"

    case "$ENV" in
        dev|dev_simple|dev_stdio)
            if [ -f "$PID_FILE" ]; then
                dev_pid="$(cat "$PID_FILE")"
                if kill "$dev_pid" 2>/dev/null; then
                    rm -f "$PID_FILE"
                    print_success "Dev server stopped (PID: $dev_pid)"
                    stopped_by_pidfile="true"
                else
                    print_warning "PID file found but process $dev_pid is not running"
                    rm -f "$PID_FILE"
                fi
            else
                print_warning "No PID file found for dev server"
            fi

            # Fallback: try to locate and stop process by dev port using lsof
            if [[ "${TRANSPORT_TYPE:-http}" == "stdio" ]]; then
                return 0
            fi
            dev_port="${SERVER_PORT:-3300}"
            if command -v lsof >/dev/null 2>&1; then
                print_info "Attempting fallback stop via lsof -ni :${dev_port}"
                # Show current listeners for debugging
                lsof -ni :"${dev_port}" 2>/dev/null || true
                # Extract PIDs and terminate them
                dev_pids="$(lsof -ti :"${dev_port}" 2>/dev/null || true)"
                if [ -n "${dev_pids:-}" ]; then
                    echo "$dev_pids" | xargs -r kill 2>/dev/null || true
                    print_success "Stopped process(es) listening on port ${dev_port} via lsof"
                else
                    print_error "lsof not available; cannot attempt port-based stop for dev server"
                fi
            fi

            if [ "$ENV" = "dev_simple" ]; then
                bash "$PROJECT_DIR/scripts/qdrant-binary.sh" stop
            fi
            ;;
        prod)
            print_info "Prod is not stopped from this script."
            ;;
    esac
}

restart() {
    stop
    sleep 2
    start
}

deploy() {
    case "$ENV" in
        dev|dev_simple|dev_stdio)
            build
            restart
            ;;
        prod)
            build
            print_info "Prod deploy: use your deployment pipeline (build only)."
            ;;
    esac
}

status() {
    print_info "Status for $ENV environment:"
    cd "$PROJECT_DIR"

    case "$ENV" in
        dev|dev_simple|dev_stdio)
            [ -f "$PID_FILE" ] && print_success "Process running (PID: $(cat "$PID_FILE"))" || print_warning "No process found"
            ;;
        prod)
            print_info "Prod status: check your deployment."
            ;;
    esac

    if [[ "${TRANSPORT_TYPE:-http}" == "stdio" ]]; then
        print_info "STDIO mode: HTTP health endpoint is not available."
    else
        # Check application health - THE MOST IMPORTANT STEP
        print_info "Checking application health..."
        if curl -s "http://localhost:${SERVER_PORT}/health" >/dev/null 2>&1; then
            print_success "App OK (port ${SERVER_PORT})"
        else
            print_warning "App DOWN (port ${SERVER_PORT})"
        fi

        # Detailed curl health output (HTTP code + body)
        {
            url="http://localhost:${SERVER_PORT}/health"
            tmpfile="$(mktemp 2>/dev/null || echo "/tmp/kb_health_$$")"
            http_code=$(curl -sS -o "$tmpfile" -w "%{http_code}" "$url" 2>/dev/null || true)
            print_info "App health HTTP: $http_code"
            if command -v jq >/dev/null 2>&1; then
                body=$(jq -C . "$tmpfile" 2>/dev/null || cat "$tmpfile")
            else
                body=$(cat "$tmpfile")
            fi
            echo "$body"
            rm -f "$tmpfile" >/dev/null 2>&1 || true
        }
    fi
    
    check_qdrant
    check_redis
    if [[ "${TRANSPORT_TYPE:-http}" != "stdio" ]]; then
        check_metrics
    fi
    # Only check TEI if not using OpenAI embeddings
    if [[ "${EMBEDDING_PROVIDER:-}" != "openai" ]] && [[ -z "${OPENAI_API_KEY:-}" || -n "${TEI_BASE_URL:-}" ]]; then
        check_tei
    fi

    if [[ "${TRANSPORT_TYPE:-http}" != "stdio" ]]; then
        show_urls
    fi

    [ -f "$LOG_FILE" ] && echo "Logs: $LOG_FILE" || print_warning "No log file"
}

test() {
    print_info "Running tests for $ENV..."
    cd "$PROJECT_DIR"
    ensure_runtime_dirs

    # Collect extra args passed after the 'test' command (e.g. tests file paths or jest flags)
    args=("$@")
    # If user provided a leading '--', remove it (npm run: 'npm run dev:test -- --flag')
    if [[ "${args[0]:-}" == "--" ]]; then
        args=("${args[@]:1}")
    fi

    # dev_simple and dev_stdio: default to the full integration suite ONLY when the caller
    # passed no explicit test selection. If the caller passed explicit test paths (positional
    # args) or their own --testPathPatterns/--testPathIgnorePatterns, respect that selection
    # verbatim and do NOT append the broad pattern: jest ORs positional args with
    # --testPathPatterns, so appending it to a smoke run (a few explicit files) would silently
    # widen the run to the entire integration suite (heavy OpenAI/embedding spend).
    # HTTP-dependent tests self-skip via isHttpTransport() when TRANSPORT_TYPE=stdio.
    # Scenario tests with specific stack requirements self-skip via their harness contracts.
    if [ "$ENV" = "dev_simple" ] || [ "$ENV" = "dev_stdio" ]; then
        has_test_selection=false
        for arg in "${args[@]}"; do
            case "$arg" in
                --testPathPatterns|--testPathIgnorePatterns)
                    has_test_selection=true
                    break
                    ;;
                -*)
                    # Other jest flag (e.g. --bail); not a test-path selection.
                    ;;
                *)
                    # Positional arg = explicit test path selection.
                    has_test_selection=true
                    break
                    ;;
            esac
        done
        if [ "$has_test_selection" = false ]; then
            args+=(
                --testPathPatterns "tests/integration/"
            )
        fi
    fi

    LAST_COMMIT="Last commit: $(git rev-parse HEAD)"
    # Use REPORT_LOG_FILE from environment if provided, otherwise generate timestamped filename
    REPORT_LOG_FILE="${REPORT_LOG_FILE:-.local/reports/tests/test-$(date +%Y%m%d-%H%M%S).log}"
    mkdir -p "$(dirname "$REPORT_LOG_FILE")"
    echo "$LAST_COMMIT" > "$REPORT_LOG_FILE"
    echo "--------------------------------" >> "$REPORT_LOG_FILE"

    case "$ENV" in
        dev|dev_simple|dev_stdio)
            if [ "$ENV" != "dev_stdio" ]; then
                # Playwright is a devDependency; browser binaries are not shipped with npm. Install the
                # Chromium bundle used by tests/integration/cli-auth-browser-login.e2e.test.ts so
                # `npm test` / `npm run dev:test` work on a fresh clone without a manual step. Idempotent
                # when ~/.cache/ms-playwright is already populated (CI restores this cache before tests).
                print_info "Ensuring Playwright Chromium for integration e2e tests..."
                npx playwright install chromium
            fi

            # Isolated CLI config for test run (CLI uses XDG_CONFIG_HOME; tests must not set it).
            CLI_CONFIG_DIR="$(mktemp -d)"
            export XDG_CONFIG_HOME="$CLI_CONFIG_DIR"
            # Forward env so globalSetup and tests see same vars as server (Jest may run globalSetup in a separate process).
            export ENV="${ENV:-dev}"
            export SERVER_PORT="${SERVER_PORT:-3300}"
            export AUTH_ENABLED="${AUTH_ENABLED:-}"
            export KEYCLOAK_URL="${KEYCLOAK_URL:-}"
            export KEYCLOAK_REALM="${KEYCLOAK_REALM:-}"
            export KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-}"
            export KEYCLOAK_CLI_CLIENT_ID="${KEYCLOAK_CLI_CLIENT_ID:-}"
            export KEYCLOAK_ADMIN_USERNAME="${KEYCLOAK_ADMIN_USERNAME:-}"
            export KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-}"
            # Prevent CLI from opening browser during tests (inherited by child processes)
            export BROWSER=true
            # In CI, run without --silent so the step log shows which test failed
            silent_flag=""
            [ "${CI:-}" = "true" ] || silent_flag="--silent"
            # Job summary (GitHub Actions): same style as Vitest's github-actions reporter
            summary_reporter=()
            if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
                summary_reporter=(--reporters default --reporters "$PROJECT_DIR/tests/reporters/jest-github-summary-reporter.cjs")
            fi
            # Serial tests (--runInBand): one MCP server; extra Jest workers did not improve wall time and caused queueing unless MAX_CONCURRENT_MCP_REQUESTS is high.
            # deploy - now need to run manually: npm run dev:deploy
            test_port="${SERVER_PORT:-3300}"
            if [ "$ENV" = "dev_stdio" ]; then
                # Stdio transport: no HTTP server, no MCP_URL needed (createMcpConnection spawns stdio subprocess).
                # --forceExit: stdio tests spawn child server processes whose open handles (Qdrant, stdio pipes)
                # would otherwise prevent Jest from exiting after all tests complete.
                # --bail=1 (equals form): stop at first failure to prevent cascading timeouts when the
                # shared stdio server fails to start. Use `=` so jest does not parse the value as a
                # positional test-path pattern (`--bail 1` would treat `1` as a path pattern).
                # Reporter array (--reporters) is variadic and MUST be terminal: jest/yargs would
                # otherwise swallow any trailing positional test paths as reporter module names.
                NODE_OPTIONS='--experimental-vm-modules' jest $silent_flag --runInBand --forceExit --bail=1 --testTimeout=30000 "${args[@]}" "${summary_reporter[@]}" 2>&1 | tee -a "$REPORT_LOG_FILE"
            elif [ ${#args[@]} -eq 0 ]; then
                # Scenario matrix: http-simple + stdio wrappers require the matching stack (see tests/integration/scenarios/).
                if [ "$ENV" = "dev" ]; then
                    # AUTH stack, read-only-first fail-fast (tests/integration reorg: readonly/ write/ mode/).
                    # Phase 1 runs read-only + shared tests (everything except the mutating write/ and
                    # mode/ buckets). Only if Phase 1 passes do we run the expensive mutating phase
                    # (write/ + mode/auth/), which is where embedding/OpenAI quota is consumed. A cheap
                    # read regression therefore short-circuits before any write work.
                    dev_ignore_scenarios='tests/integration/scenarios/spaces-tool.http-simple.test.ts|tests/integration/scenarios/spaces-tool.stdio-simple.test.ts'
                    print_info "Integration Phase 1/2 (read-only + shared, fail-fast)"
                    if ! MCP_URL="http://localhost:${test_port}/mcp" NODE_OPTIONS='--experimental-vm-modules' jest $silent_flag --runInBand --forceExit --testTimeout=30000 "${summary_reporter[@]}" --testPathPatterns "tests/integration/" --testPathIgnorePatterns "$dev_ignore_scenarios|tests/integration/write/|tests/integration/mode/" 2>&1 | tee -a "$REPORT_LOG_FILE"; then
                        print_error "Read-only phase failed — skipping write phase to conserve embedding quota."
                        exit 1
                    fi
                    print_info "Integration Phase 2/2 (write + auth-mode)"
                    MCP_URL="http://localhost:${test_port}/mcp" NODE_OPTIONS='--experimental-vm-modules' jest $silent_flag --runInBand --forceExit --testTimeout=30000 "${summary_reporter[@]}" --testPathPatterns "tests/integration/write/|tests/integration/mode/auth/" 2>&1 | tee -a "$REPORT_LOG_FILE"
                else
                    # dev_simple: full suite in one pass (transport self-skips handle stack-specific tests).
                    MCP_URL="http://localhost:${test_port}/mcp" NODE_OPTIONS='--experimental-vm-modules' jest $silent_flag --runInBand --forceExit --testTimeout=30000 "${summary_reporter[@]}" --testPathPatterns "tests/integration/" 2>&1 | tee -a "$REPORT_LOG_FILE"
                fi
            else
                # Reporter array (--reporters) is variadic and MUST be terminal: jest/yargs would
                # otherwise swallow the trailing positional test paths as reporter module names.
                MCP_URL="http://localhost:${test_port}/mcp" NODE_OPTIONS='--experimental-vm-modules' jest $silent_flag --runInBand --forceExit --testTimeout=30000 "${args[@]}" "${summary_reporter[@]}" 2>&1 | tee -a "$REPORT_LOG_FILE"
            fi
            ;;
        prod)
            print_warning "Tests are not run against prod from this script."
            ;;
    esac
}

logs() {
    case "$ENV" in
        dev|dev_simple|dev_stdio)
            [ -f "$LOG_FILE" ] && cat "$LOG_FILE" || print_warning "No log file found"
            ;;
        prod)
            print_warning "Prod logs: check your deployment."
            ;;
    esac
}

health() {
    print_info "Health check for $ENV:"
    check_qdrant
    check_redis
    # Only check TEI if not using OpenAI embeddings
    if [[ "${EMBEDDING_PROVIDER:-}" != "openai" ]] && [[ -z "${OPENAI_API_KEY:-}" || -n "${TEI_BASE_URL:-}" ]]; then
        check_tei
    fi
}

health_qdrant() {
    print_info "Checking Qdrant health..."
    url="${QDRANT_URL:-http://localhost:6333}"
    url=${url%/}/healthz
    
    if [[ -n "${QDRANT_API_KEY:-}" ]]; then
        curl -X GET "$url" --header "api-key: ${QDRANT_API_KEY}"
    else
        curl -X GET "$url"
    fi
}

health_tei() {
    print_info "Checking TEI health..."
    url="${TEI_BASE_URL:-http://localhost:8080}"
    url=${url%/}
    curl -I "$url/health"
}

ensure_coding_rules() {
    
  local branch
  
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || {
    print_error "Not a git repository."
    exit 1
  }

  # Check: on main branch
  if [ "$branch" = "main" ]; then
    print_error "Operation not allowed on 'main' branch (AI coding rules -> CREATE ISOLATED BRANCH)."
    exit 1
  fi
  print_success "Not on 'main' branch (current: $branch)"

  # Check: unstaged changes
  if ! git diff --quiet; then
    print_error "Uncommitted changes detected (unstaged). Commit or stash changes before proceeding (AI coding rules -> CLEAN WORKING TREE REQUIRED)."
    exit 1
  fi
  print_success "No unstaged changes detected"

  # Check: staged changes
  if ! git diff --cached --quiet; then
    print_error "Uncommitted changes detected (staged). Commit or unstage changes before proceeding (AI coding rules -> CLEAN WORKING TREE REQUIRED)."
    exit 1
  fi
  print_success "No staged changes detected"
  
  print_success "Working tree is clean (AI coding rules -> CLEAN WORKING TREE REQUIRED)"

  # Check if test reports exist (prefer .local/reports/tests; fallback to reports/tests)
  latest_test_report=""
  report_root=""
  if [ -d ".local/reports/tests" ]; then
    report_root=".local/reports/tests"
  elif [ -d "reports/tests" ]; then
    report_root="reports/tests"
  fi
  if [ -z "$report_root" ]; then
    print_warning "No .local/reports/tests or reports/tests directory found (test reports may not have been generated)"
  else
    commit_hash=$(git rev-parse HEAD)

    mapfile -t all_log_files < <(find "$report_root" -type f -name "*.log")
    if [ ${#all_log_files[@]} -eq 0 ]; then
      print_error "No test report files found in $report_root (run tests to generate proof)."
      exit 1
    fi

    mapfile -t report_log_files < <(grep -Fl "$commit_hash" "${all_log_files[@]}" 2>/dev/null || true)
    if [ ${#report_log_files[@]} -eq 0 ]; then
      print_error "No proof-of-work test report references commit $commit_hash (run tests and archive logs)."
      exit 1
    fi
    latest_test_report=$(printf '%s\0' "${report_log_files[@]}" | xargs -0 stat -f "%m:%N" 2>/dev/null | sort -rn | head -n 1 | cut -d':' -f2-)
    if [ -z "$latest_test_report" ]; then
      print_error "Unable to determine latest test report for commit $commit_hash."
      exit 1
    fi
    print_success "Proof-of-work test report found for commit $commit_hash: $latest_test_report"

    # Check the newest proof-of-work report for failures
    if [ -n "$latest_test_report" ]; then
      print_success "Test reports found in $report_root"
      # Check if latest report contains "Test Suites:" (indicates test run completed)
      if grep -q "Test Suites:" "$latest_test_report" 2>/dev/null; then
        print_success "Test report contains Test Suites information: $latest_test_report"
        
        # Check for failures in latest report file
        if grep -Eq 'FAIL|failed' "$latest_test_report" 2>/dev/null; then
          print_error "Failures found in latest report file (AI coding rules -> NO FAILURES REQUIRED)."
          exit 1
        fi
        print_success "All tests PASSED (AI coding rules -> NO FAILURES REQUIRED): $latest_test_report"
      else
        print_warning "Latest test report may not be complete: $latest_test_report"
      fi
    else
      print_warning "No test report files found in $report_root"
    fi
  fi

  # All good
  print_success "Coding rules enforced successfully."
}

# handoff() {
#   print_info "Running handoff workflow for $ENV environment..."
#   ensure_coding_rules
#   deploy
#   test
#   print_success "Handoff complete: deploy, test, and git safety checks passed."
# }

help() {
    echo "kairos Environment Script"
    echo "USAGE: ENV=dev|dev_simple|dev_stdio|prod $0 [build|start|stop|restart|status|test|logs|health|ensure-coding-rules|redis-cli|qdrant-curl] [-- <args>]"
    echo ""
    echo "Single .env; prod is not managed here (exception: Keycloak realm setup)."
    echo "ENVIRONMENTS:"
    echo "  dev        - Local app (start, stop, test, build). SERVER_PORT=3300 default."
    echo "  dev_simple - Local app simple mode profile. SERVER_PORT=4300 default."
    echo "  dev_stdio  - Local app stdio mode profile. SERVER_PORT=4300 default."
    echo "  prod       - Inspect only when .env points at prod (health, status, qdrant-curl, redis-cli, logs)."
    echo ""
    echo "ENV VARS (from .env):"
    echo "  SERVER_PORT        - Main HTTP listener (UI, REST, Streamable HTTP MCP)"
    echo "  QDRANT_URL         - Qdrant base URL (default http://localhost:6333)"
    echo "  \$QDRANT_API_KEY    - Qdrant API key (sent as 'api-key' header)"
    echo "  QDRANT_COLLECTION  - Qdrant collection name (default kairos)"
    echo "  TEI_BASE_URL       - TEI base URL (default http://localhost:8080)"
    echo "  REDIS_URL          - Redis connection URL (default redis://localhost:6379)"
    echo "  KAIROS_REDIS_PREFIX    - Redis key prefix for namespacing (default kb:)"
    echo "  LOG_TARGET         - Log output target (file|stdout|both, default: file)"
    echo "  LOG_LEVEL          - Log level filter (info|debug|warn|error, default: info)"
    echo "  LOG_FORMAT         - Log output format (text|json, default: text)"
    echo ""
    echo "COMMANDS:"
    echo "  build    - Build TypeScript"
    echo "  start    - Start services"
    echo "  stop     - Stop services"
    echo "  restart  - Restart services"
    echo "  status   - Show status"
    echo "  test     - Run tests (accepts additional args forwarded to Jest; example: npm run dev:test -- tests/integration/file.test.ts)"
    echo "  logs     - Show logs"
    echo "  health   - Check dependencies"
    echo "  health-qdrant - Check Qdrant health"
    echo "  health-tei - Check TEI health"
    echo "  ensure-coding-rules - Verify git state (not on main, clean working tree) for AI coding rules enforcement"
    # echo "  handoff - Complete workflow: ensure git safe, deploy, test, and verify git safe again"
    echo "  redis-cli [commands...] - Execute Redis CLI commands against Redis server"
    
}

# Main - parse command and forward remaining args as parameters to subcommands
cmd="${1:-help}"
shift || true
case "$cmd" in
    build) build ;;
    start) start ;;
    stop) stop ;;
    restart) restart ;;
    deploy) deploy ;;
    status) status ;;
    test) test "$@" ;;
    logs) logs ;;
    health) health ;;
    health-qdrant) health_qdrant ;;
    health-tei) health_tei ;;
    ensure-coding-rules) ensure_coding_rules ;;
    # handoff) handoff ;;
    
    # Context7 Integration: Redis and Qdrant CLI Targets
    redis-cli)
        # Remaining args (if any) are forwarded as Redis CLI commands
        if [[ -z "$@" ]]; then
            print_info "Example: ./scripts/deploy-run-env.sh redis-cli PING"
            print_info "Actual Command: redis-cli -u $(mask_url "${REDIS_URL:-redis://localhost:6379}") PING"
        else
            redis-cli -u "${REDIS_URL:-redis://localhost:6379}" "$@"
        fi
        ;;
    
    qdrant-curl)
        # Remaining args: <METHOD> <ENDPOINT>
        method="${1:-GET}"
        endpoint="${2:-collections}"
        if [[ -z "${QDRANT_API_KEY:-}" || -z "${QDRANT_URL:-}" ]]; then
            print_error "Missing QDRANT_API_KEY or QDRANT_URL environment variables."
            exit 1
        fi
        curl -s -X "$method" \
            -H "api-key: $QDRANT_API_KEY" \
            "${QDRANT_URL%/}/$endpoint" | jq
        ;;
    help|--help|-h) help ;;
    *) print_error "Unknown command: $1"; help; exit 1 ;;
esac
