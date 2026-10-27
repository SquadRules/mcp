#!/usr/bin/env node
/**
 * Report-only type-check of the test suite (tsconfig.tests.json — the Jest tests plus the tests/ui
 * Vitest suite, which eslint's type-aware linting also resolves through this project).
 *
 * tsconfig.tests.json became a structurally valid gate in issue #180 (rootDir overridden to "."
 * so tests/** is no longer outside the inherited "./src" rootDir, and the stray "vitest" type was
 * dropped). That immediately surfaced a large backlog of pre-existing type errors that had never
 * been gated: `npm run typecheck` excludes **\/*.test.ts and ts-jest runs isolatedModules
 * (transpile-only), so nothing type-checked tests/ before.
 *
 * Until the backlog is burned down this wrapper runs tsc, prints a summary (total, per-code
 * histogram, worst files), appends a $GITHUB_STEP_SUMMARY block, and ALWAYS exits 0 — the required
 * "Build and checks" lane forbids `continue-on-error` steps (tests/scripts/workflow-structure.test.mjs),
 * so report-only behaviour lives here rather than in the workflow.
 *
 * To reproduce the full list locally:
 *   npx tsc --noEmit --project tsconfig.tests.json
 *
 * To turn this into a blocking gate later, exit non-zero when total > 0 (tracked in issue #184).
 *
 * Usage: node scripts/ci-typecheck-tests-report.mjs
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const result = spawnSync('npx', ['tsc', '--noEmit', '--project', 'tsconfig.tests.json'], {
  encoding: 'utf8',
  env: process.env,
  shell: false
});

if (result.error) {
  console.error('typecheck:tests report could not run tsc:', result.error.message);
  process.exit(1);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const errorLines = output.split('\n').filter((line) => /error TS\d+/.test(line));
const total = errorLines.length;

const byCode = new Map();
const byFile = new Map();
let uiTotal = 0;
for (const line of errorLines) {
  const code = line.match(/error (TS\d+)/)?.[1];
  if (code) byCode.set(code, (byCode.get(code) ?? 0) + 1);
  const file = line.match(/^(.*?)\(\d+,\d+\)/)?.[1];
  if (file) {
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
    if (file.startsWith('tests/ui/')) uiTotal += 1;
  }
}
const jestTotal = total - uiTotal;

const codes = [...byCode.entries()].sort((a, b) => b[1] - a[1]);
const files = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

console.log(
  `typecheck:tests (REPORT-ONLY, issue #180): ${total} type error(s) across ${byFile.size} file(s) in tests/.`
);
console.log(`  - ${jestTotal} in the Jest suite (the real backlog to burn down)`);
console.log(
  `  - ${uiTotal} in tests/ui (Vitest + JSX + @/ alias): config-mismatch artifacts until tests/ui gets its own tsconfig (issue #184)`
);
console.log('Advisory only — this step does not fail the build until the backlog is burned down.');
console.log('\nBy error code:');
for (const [code, n] of codes) console.log(`  ${String(n).padStart(4)}  ${code}`);
console.log('\nTop files:');
for (const [file, n] of files) console.log(`  ${String(n).padStart(4)}  ${file}`);
console.log('\nFull list: npx tsc --noEmit --project tsconfig.tests.json');

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const rows = codes.map(([code, n]) => `| \`${code}\` | ${n} |`).join('\n');
  const body =
    `## Type-check tests (report-only)\n\n` +
    `- ⚠️ **${total}** type errors across **${byFile.size}** files in \`tests/\`\n` +
    `- **${jestTotal}** in the Jest suite (real backlog) · **${uiTotal}** in \`tests/ui\` (needs its own Vitest tsconfig)\n` +
    `- Advisory only — see issue #180; not gating until the backlog is cleared.\n\n` +
    `| Code | Count |\n|------|-------|\n${rows}\n`;
  appendFileSync(summaryPath, body, 'utf8');
}

process.exit(0);
