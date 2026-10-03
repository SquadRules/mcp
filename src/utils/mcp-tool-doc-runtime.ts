// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { GROUP_SPACE_PATH_EXAMPLE } from '../config.js';
import { getToolDoc } from '../resources/embedded-mcp-resources.js';

const GROUP_SPACE_PLACEHOLDER = '{{KAIROS_GROUP_SPACE_PATH_EXAMPLE}}';

/**
 * Embedded tool markdown may contain `{{KAIROS_GROUP_SPACE_PATH_EXAMPLE}}`; replace
 * with the deployment-specific path from config (see GROUP_SPACE_PATH_EXAMPLE).
 */
export function resolveToolDoc(key: string): string | undefined {
  const raw = getToolDoc(key);
  if (!raw) return undefined;
  if (!raw.includes(GROUP_SPACE_PLACEHOLDER)) return raw;
  return raw.split(GROUP_SPACE_PLACEHOLDER).join(GROUP_SPACE_PATH_EXAMPLE);
}
