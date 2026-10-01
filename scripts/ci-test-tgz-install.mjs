#!/usr/bin/env node
/**
 * Installs the built tgz (from npm pack) into a temp dir and runs a quick smoke test.
 * Ensures the package can be installed and the CLI runs. Used before publish.
 */
import { spawnSync } from "child_process";
import { mkdtempSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pkg = require(join(root, "package.json"));
const version = pkg.version;
const tgzName = `squadrules-mcp-${version}.tgz`;
const tgzPath = join(root, "dist", tgzName);
// Use OS temp dir so Node cannot resolve missing deps from repo-root node_modules.
const testDir = mkdtempSync(join(tmpdir(), "squadrules-tgz-install-test-"));

function run(cmd, args, cwd = root, desc) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    console.error(`Error: ${desc || `${cmd} ${args.join(" ")}`} failed (exit ${r.status})`);
    process.exit(1);
  }
}

if (!existsSync(tgzPath)) {
  console.error(`Error: tgz not found at ${tgzPath}. Run 'npm run build:tgz' first.`);
  process.exit(1);
}

try {
  run("npm", ["init", "-y"], testDir, "npm init");
  run("npm", ["install", tgzPath], testDir, "npm install <tgz>");
  run("npx", ["kairos", "--version"], testDir, "npx kairos --version");
  run("npx", ["kairos-mcp", "--version"], testDir, "npx kairos-mcp --version");
  run("npx", ["kairos", "serve", "--help"], testDir, "npx kairos serve --help");
  run("npx", ["kairos-mcp", "serve", "--help"], testDir, "npx kairos-mcp serve --help");
} finally {
  rmSync(testDir, { recursive: true, force: true });
}

console.log(
  "test:tgz OK — install, kairos --version, kairos-mcp --version, and serve --help succeeded."
);
