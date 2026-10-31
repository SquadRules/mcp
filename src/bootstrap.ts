/**
 * Bootstrap entry: installs process error handlers before any app code loads,
 * so uncaught exceptions during import (e.g. [Object: null prototype]) are
 * logged with a readable message instead of Node's default dump.
 * Then dynamically imports index.js and awaits runSquadrulesServer() (argv[1] is bootstrap.js, so index's isDirectRun() is false).
 * Uses process.stderr (not console) so verify-clean-source allows this file.
 * The only module loaded before the handlers is the pure safeStringify helper
 * (no side effects, cannot throw at import); handlers are registered before
 * any other import() so they run before app code loads.
 */

function stderr(msg: string): void {
  process.stderr.write(`${msg}\n`);
}
const { safeStringify } = await import('./utils/safe-stringify.js');
process.on('uncaughtException', (err: unknown) => {
  try {
    stderr(`[bootstrap] Uncaught exception: ${safeStringify(err)}`);
  } catch {
    stderr('[bootstrap] Uncaught exception (unserializable)');
  }
  process.exitCode = 1;
});
process.on('unhandledRejection', (reason: unknown) => {
  try {
    stderr(`[bootstrap] Unhandled rejection: ${safeStringify(reason)}`);
  } catch {
    stderr('[bootstrap] Unhandled rejection (unserializable)');
  }
});

const { runSquadrulesServer } = await import('./index.js');
await runSquadrulesServer();
