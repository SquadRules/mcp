import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** npm `version` from repo root `package.json` (single source for Vite + Vitest `define`). */
export function getPackageVersionForUi(): string {
  try {
    const pkgPath = join(repoRoot, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Vite/Vitest `define` map so the UI reads `import.meta.env.VITE_SQUADRULES_VERSION`. */
export function getUiImportMetaEnvDefine(): Record<string, string> {
  return {
    "import.meta.env.VITE_SQUADRULES_VERSION": JSON.stringify(getPackageVersionForUi()),
  };
}
