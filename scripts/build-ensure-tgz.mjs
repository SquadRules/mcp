#!/usr/bin/env node
/**
 * Ensure dist/<name>-<version>.tgz exists. If it does, skip. Otherwise build and npm pack.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
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

if (existsSync(tgzPath)) {
  console.log(`tgz exists: ${tgzPath} (skipping build and pack)`);
  process.exit(0);
}

function run(cmd, args, desc) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    console.error(`Error: ${desc || `${cmd} ${args.join(" ")}`} failed (exit ${r.status})`);
    process.exit(1);
  }
}

run("npm", ["run", "build"], "npm run build");
run("npm", ["pack", "--pack-destination", "dist"], "npm pack");
console.log(`Created ${tgzPath}`);
