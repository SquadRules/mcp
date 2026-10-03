/**
 * Shared MCP + spaces snapshot for adapter space integration tests.
 */

import { createMcpConnection } from '../../utils/mcp-client-utils.js';
import { parseMcpJson } from '../../utils/expect-with-raw.js';
import { hasAuthToken, refreshTestAuthToken, serverRequiresAuth } from '../../utils/auth-headers.js';
import type { SpaceRow } from '../../utils/adapter-space-test-helpers.js';
import { CI_TEST_SPACE_PARAM } from '../../utils/space-test-constants.js';

function pickGroupSpaceName(rows: SpaceRow[]): string | null {
  const prefer = rows.find(
    (s) =>
      s.type === 'group' &&
      (s.name.includes('ci-test') || s.name.includes(CI_TEST_SPACE_PARAM))
  );
  return prefer?.name ?? rows.find((s) => s.type === 'group')?.name ?? null;
}

/** `group` — train/tune into shared spaces (requires a `type: group` row from `spaces`). `personal` — personal-only CRUD. */
export type AdapterSpaceSkipMode = 'personal' | 'group';

export type AdapterSpaceMcpBundle = {
  mcp: Awaited<ReturnType<typeof createMcpConnection>>;
  groupSpaceName: string | null;
  personalSpaceName: string | null;
  loadSpacesViaMcp: () => Promise<SpaceRow[]>;
  skipReason: (serverOk: boolean, mode?: AdapterSpaceSkipMode) => string | null;
};

export async function openAdapterSpaceMcpBundle(): Promise<AdapterSpaceMcpBundle | null> {
  if (!serverRequiresAuth()) return null;
  await refreshTestAuthToken();
  if (!hasAuthToken()) return null;
  const mcp = await createMcpConnection();
  const spacesRes = await mcp.client.callTool({
    name: 'spaces',
    arguments: { include_adapter_titles: true }
  });
  const parsed = parseMcpJson(spacesRes, 'spaces-adapter-move');
  const rows = (parsed.spaces ?? []) as SpaceRow[];
  const groupSpaceName = pickGroupSpaceName(rows);
  const p = rows.find((s) => s.type === 'personal');
  const personalSpaceName = p?.name ?? null;

  const loadSpacesViaMcp = async (): Promise<SpaceRow[]> => {
    const result = await mcp.client.callTool({
      name: 'spaces',
      arguments: { include_adapter_titles: true }
    });
    const pr = parseMcpJson(result, 'spaces');
    return (pr.spaces ?? []) as SpaceRow[];
  };

  const skipReason = (serverOk: boolean, mode: AdapterSpaceSkipMode = 'group'): string | null => {
    if (!serverRequiresAuth() || !hasAuthToken()) return 'auth disabled or no token';
    if (!serverOk) return 'server unavailable';
    if (!personalSpaceName) return 'no personal space';
    if (mode === 'personal') return null;
    if (!groupSpaceName) {
      return (
        'spaces returned no type:group row — JWT must include groups (Keycloak Group Membership + squadrules-groups scope); ' +
        'empty OIDC_GROUPS_ALLOWLIST keeps all token groups (see GitHub #278)'
      );
    }
    return null;
  };

  return { mcp, groupSpaceName, personalSpaceName, loadSpacesViaMcp, skipReason };
}

/**
 * When auth is on and the server is up, missing group rows is a hard failure (regression guard for #278),
 * not a silent skip.
 */
export function assertGroupSpacesWhenAuth(
  bundle: AdapterSpaceMcpBundle | null,
  serverOk: boolean
): asserts bundle is AdapterSpaceMcpBundle {
  if (!serverOk) return;
  if (!serverRequiresAuth() || !hasAuthToken()) return;
  if (!bundle) {
    throw new Error(
      'openAdapterSpaceMcpBundle returned null while auth and server are up — MCP connection failed'
    );
  }
  const why = bundle.skipReason(true, 'group');
  if (why) {
    throw new Error(`${why}`);
  }
}

/** Null bundle means auth off or missing token (see {@link openAdapterSpaceMcpBundle}). */
export function adapterSpaceSkipReason(
  bundle: AdapterSpaceMcpBundle | null,
  serverOk: boolean,
  mode: AdapterSpaceSkipMode = 'group'
): string | null {
  if (bundle == null) {
    if (!serverRequiresAuth() || !hasAuthToken()) return 'auth disabled or no token';
    return 'MCP connection failed';
  }
  return bundle.skipReason(serverOk, mode);
}
