// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Resolve local SQUADRULES HTTP base URL for repo scripts (no trailing slash).
 * Loads `.env` from the repo root without overriding variables already set in the environment.
 */
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let repoEnvLoaded = false;

export function loadRepoEnv() {
  if (repoEnvLoaded) return;
  repoEnvLoaded = true;
  config({ path: join(REPO_ROOT, ".env") });
}

/**
 * Precedence: KAIROS_BASE_URL, KAIROS_API_URL, else http://localhost:$SERVER_PORT (default 3300, same as deploy-run-env.sh dev).
 */
export function resolveSquadrulesAppBaseUrl() {
  loadRepoEnv();
  const fromBase = process.env.KAIROS_BASE_URL?.trim();
  if (fromBase) return fromBase.replace(/\/$/, "");
  const fromApi = process.env.KAIROS_API_URL?.trim();
  if (fromApi) return fromApi.replace(/\/$/, "");
  const port = process.env.SERVER_PORT?.trim() || "3300";
  return `http://localhost:${port}`;
}
