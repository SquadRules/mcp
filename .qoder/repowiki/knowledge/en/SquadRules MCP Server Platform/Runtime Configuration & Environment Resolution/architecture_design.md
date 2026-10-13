Flat collection of small, single-responsibility config modules re-exported from `../config.ts` to keep that file under a max-lines budget. Each file owns one concern:
- `runtime-mode.ts`: core resolver — derives `TRANSPORT_TYPE` (`stdio` vs `http`) from `SQUADRULES_MCP_STDIO`, `SQUADRULES_CLI_SERVE`, and explicit `TRANSPORT_TYPE`; gates `AUTH_ENABLED` behind transport; validates stdio-only constraints (no auth, no external Qdrant) via `getStdioConfigViolations` / `assertStdioConfigConsistency`.
- `embedding-fastembed.ts`: fastembed model name and shared cache dir (via `utils/squadrules-user-dirs`).
- `export-download-settings.ts`: signed export download secret (falls back to `SESSION_SECRET`, process-local random if neither set) plus TTL and public base URL resolution.
- `export-zip-settings.ts`: zlib compression level for skill ZIP archives, read per-call so env changes apply without restart.
- `adapter-markdown-size-limits.ts`: `AdapterMarkdownSizeLimits` interface with `maxLines`, `maxLineBytes`, `safetyFactor`, `maxTotalBytes` derived from `SQUADRULES_ADAPTER_MARKDOWN_*` vars.
- `mem-boot.ts`: `MEM_BOOT_FORCE_INJECT` escape hatch for forcing delete-then-retrain of shipped adapters at boot.

Dependency direction is inward only: this module reads `process.env` and imports from `utils/` and `../config.ts` (re-export surface); nothing in this directory imports application services or HTTP layers.