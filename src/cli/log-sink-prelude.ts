/**
 * CLI log-sink prelude — MUST be the first import in `cli/index.ts`.
 *
 * The CLI reserves stdout for command payloads (`activate`/`forward`/`reward`/`export`
 * JSON, text, etc.). In local (in-process) mode the runtime boots and emits INFO logs,
 * but a data command is not a local *server* launch, so `TRANSPORT_TYPE` resolves to
 * `http` (see `config/runtime-mode.ts`) and the shared pino sink would otherwise write
 * those logs to stdout — corrupting the payload (`activate ... | jq` fails to parse).
 *
 * Setting the flag here, before the module graph eagerly creates the logger singleton in
 * `utils/structured-logger.ts`, routes all CLI logs to stderr (ADR 0008: stdout is a data
 * channel). The spawned `serve` child overrides this per its own transport
 * (see `commands/serve.ts`), so an http server keeps logging to stdout as containers expect.
 */
process.env['SQUADRULES_LOG_STDERR'] = '1';

// Piping a payload to a consumer that exits early (`... | head`, or `jq` after a parse
// error) closes stdout; the next write then emits EPIPE. Attach an error handler so the
// CLI ends cleanly instead of crashing with an unhandled 'error' event on the socket.
process.stdout.on('error', () => {
  // Ignore stdout write errors (EPIPE from an early-exiting pipe consumer).
});

export {};
