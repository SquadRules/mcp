import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Override output root (default: `<cwd>/.local/mime-fixture-export`). */
export const MIME_FIXTURE_EXPORT_DIR_ENV = 'SQUADRULES_MIME_FIXTURE_EXPORT_DIR';

function resolveExportDumpRoot(cwd: string = process.cwd()): string {
  const override = process.env[MIME_FIXTURE_EXPORT_DIR_ENV]?.trim();
  if (override) return path.resolve(override);
  return path.resolve(cwd, '.local', 'mime-fixture-export');
}

/**
 * Deletes the entire mime export dump root and recreates an empty directory.
 */
export function resetMimeFixtureExportDumpRootSync(cwd: string = process.cwd()): void {
  const root = resolveExportDumpRoot(cwd);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

let mimeFixtureExportDumpCleanedThisJestWorker = false;

/**
 * Runs **once per Jest worker** the first time a mime export parity file mounts.
 * Clears **before** those tests (not during `dev:deploy`). Subsequent mime files on
 * the same worker reuse the directory so api + mcp + cli evidence accumulates in one run.
 */
export function ensureMimeFixtureExportDumpRootCleanBeforeMimeTests(cwd: string = process.cwd()): void {
  if (mimeFixtureExportDumpCleanedThisJestWorker) return;
  mimeFixtureExportDumpCleanedThisJestWorker = true;
  resetMimeFixtureExportDumpRootSync(cwd);
}

export interface MimeFixtureExportDumpArgs {
  transport: 'api' | 'mcp' | 'cli';
  format: 'skill_tree' | 'skill_zip';
  stage: 0 | 1 | 2;
  slug: string;
  files: Map<string, Buffer>;
  /** GNU-style SHA256SUMS body as returned by export parsing (optional but useful for diffing). */
  sumsBody?: string;
}

/**
 * Writes each parsed export bundle to disk so you can diff against
 * `tests/test-data/mime-artifact-sample` (or prior runs). Required for mime
 * export parity tests: failures throw and fail the test.
 *
 * **Layout:** `<cwd>/.local/mime-fixture-export/<pid>/<transport>/<format>/stage<N>/`
 * (`<pid>` avoids clashes when Jest runs files in parallel).
 *
 * **Override root:** `SQUADRULES_MIME_FIXTURE_EXPORT_DIR`
 */
export function dumpMimeFixtureExport(args: MimeFixtureExportDumpArgs): void {
  const root = path.join(resolveExportDumpRoot(process.cwd()), String(process.pid), args.transport, args.format, `stage${args.stage}`);
  mkdirSync(root, { recursive: true });

  const sortedPaths = [...args.files.keys()].sort();
  for (const rel of sortedPaths) {
    const buf = args.files.get(rel);
    if (!buf) continue;
    const dest = path.join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
  }

  if (args.sumsBody !== undefined) {
    writeFileSync(path.join(root, 'SHA256SUMS.exported'), args.sumsBody, 'utf8');
  }

  writeFileSync(
    path.join(root, 'export-dump-meta.json'),
    JSON.stringify(
      {
        transport: args.transport,
        format: args.format,
        stage: args.stage,
        slug: args.slug,
        dumpedAt: new Date().toISOString(),
        paths: sortedPaths
      },
      null,
      2
    ),
    'utf8'
  );
}
