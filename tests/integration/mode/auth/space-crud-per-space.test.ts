/**
 * Per-space CRUD (train / tune / delete) and cross-space moves via tune(space).
 * Requires AUTH_ENABLED + token with personal + /shared/ci-test group (deploy-configure-keycloak-realms.py).
 */

import { parseMcpJson, withRawOnFail } from '../../../utils/expect-with-raw.js';
import {
  buildSpaceMoveMarkdown,
  locationsForAdapterTitle,
  sleepMs
} from '../../../utils/adapter-space-test-helpers.js';
import { CI_TEST_SPACE_PARAM } from '../../../utils/space-test-constants.js';
import { MOCK_REVIEW_EVIDENCE } from '../../../utils/mock-review-evidence.js';
import {
  adapterSpaceSkipReason,
  assertGroupSpacesWhenAuth,
  openAdapterSpaceMcpBundle
} from '../../utils/adapter-space-mcp-context.js';
import { hasAuthToken, serverRequiresAuth, isHttpTransport } from '../../../utils/auth-headers.js';
import { setupServerCheck } from '../../cli-commands-shared.js';

const _d = isHttpTransport() ? describe : describe.skip;

/** Adapter identity is UUIDv5(H1); tune by adapter URI must keep the H1 stable — change body only. */
function mdWithTitle(title: string, activationLine = 'Space CRUD integration test.'): string {
  return `# ${title}

## Activation Patterns
${activationLine}

## Step 1
Body.

\`\`\`json
{"contract": {"type": "comment", "comment": {"min_length": 10}, "required": true}}
\`\`\`

## Reward Signal
Done.`;
}

_d('Space CRUD per space (MCP)', () => {
  let bundle: Awaited<ReturnType<typeof openAdapterSpaceMcpBundle>> = null;
  let serverOk = false;

  beforeAll(async () => {
    serverOk = await setupServerCheck();
    bundle = await openAdapterSpaceMcpBundle();
  }, 120000);

  afterAll(async () => {
    if (bundle?.mcp) await bundle.mcp.close();
  });

  test('personal: train → tune (update) → delete', async () => {
    if (!serverOk) {
      console.warn('[space-crud] skip personal: server unavailable');
      return;
    }
    if (!serverRequiresAuth() || !hasAuthToken()) {
      console.warn('[space-crud] skip personal: auth disabled or no token');
      return;
    }
    const why = adapterSpaceSkipReason(bundle, serverOk, 'personal');
    if (why || !bundle) {
      console.warn(`[space-crud] skip personal: ${why}`);
      return;
    }
    expect.hasAssertions();
    const { mcp, loadSpacesViaMcp } = bundle;
    const title = `SpaceCrudPersonal ${Date.now()}`;
    const trainCall = {
      name: 'train',
      arguments: {
        content: mdWithTitle(title),
        llm_model_id: 'test-space-crud-personal',
        space: 'personal',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    };
    const trainRes = await mcp.client.callTool(trainCall);
    const trained = parseMcpJson(trainRes, 'train-crud-personal');
    withRawOnFail({ call: trainCall, result: trainRes }, () => {
      expect(trained.status).toBe('stored');
    });
    const adapterUri = trained.items[0].adapter_uri as string;

    await sleepMs(2000);
    let spaces = await loadSpacesViaMcp();
    expect(locationsForAdapterTitle(spaces, title).some((l) => l.type === 'personal')).toBe(true);

    const tuneCall = {
      name: 'tune',
      arguments: {
        uris: [adapterUri],
        content: [mdWithTitle(title, 'Space CRUD integration test after tune.')],
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    };
    const tuneRes = await mcp.client.callTool(tuneCall);
    const tuned = parseMcpJson(tuneRes, 'tune-crud-personal');
    withRawOnFail({ call: tuneCall, result: tuneRes }, () => {
      expect(tuned.total_updated).toBeGreaterThanOrEqual(1);
    });

    await sleepMs(2000);
    spaces = await loadSpacesViaMcp();
    expect(locationsForAdapterTitle(spaces, title).some((l) => l.type === 'personal')).toBe(true);

    const delCall = { name: 'delete', arguments: { uris: [adapterUri] } };
    const delRes = await mcp.client.callTool(delCall);
    const deleted = parseMcpJson(delRes, 'delete-crud-personal');
    withRawOnFail({ call: delCall, result: delRes }, () => {
      expect(deleted.total_deleted).toBeGreaterThanOrEqual(1);
    });
  }, 120000);

  test('group /shared/ci-test: train → tune → delete', async () => {
    if (!serverOk) {
      console.warn('[space-crud] skip group: server unavailable');
      return;
    }
    if (!serverRequiresAuth() || !hasAuthToken()) {
      console.warn('[space-crud] skip group: auth disabled or no token');
      return;
    }
    assertGroupSpacesWhenAuth(bundle, serverOk);
    expect.hasAssertions();
    const { mcp, groupSpaceName, loadSpacesViaMcp } = bundle;
    if (!groupSpaceName?.includes('ci-test')) {
      throw new Error(
        '[space-crud] expected a group space for /shared/ci-test (squadrules-tester); run scripts/deploy-configure-keycloak-realms.py'
      );
    }
    const title = `SpaceCrudGroup ${Date.now()}`;
    const trainCall = {
      name: 'train',
      arguments: {
        content: mdWithTitle(title),
        llm_model_id: 'test-space-crud-group',
        space: CI_TEST_SPACE_PARAM,
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    };
    const trainRes = await mcp.client.callTool(trainCall);
    const trained = parseMcpJson(trainRes, 'train-crud-group');
    withRawOnFail({ call: trainCall, result: trainRes }, () => {
      expect(trained.status).toBe('stored');
    });
    const adapterUri = trained.items[0].adapter_uri as string;

    await sleepMs(2000);
    let spaces = await loadSpacesViaMcp();
    expect(locationsForAdapterTitle(spaces, title).some((l) => l.type === 'group')).toBe(true);

    const tuneCall = {
      name: 'tune',
      arguments: {
        uris: [adapterUri],
        content: [mdWithTitle(title, 'Space CRUD integration test after tune.')],
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    };
    const tuneRes = await mcp.client.callTool(tuneCall);
    const tuned = parseMcpJson(tuneRes, 'tune-crud-group');
    withRawOnFail({ call: tuneCall, result: tuneRes }, () => {
      expect(tuned.total_updated).toBeGreaterThanOrEqual(1);
    });

    await sleepMs(2000);
    spaces = await loadSpacesViaMcp();
    expect(locationsForAdapterTitle(spaces, title).some((l) => l.type === 'group')).toBe(true);

    const delCall = { name: 'delete', arguments: { uris: [adapterUri] } };
    const delRes = await mcp.client.callTool(delCall);
    const deleted = parseMcpJson(delRes, 'delete-crud-group');
    withRawOnFail({ call: delCall, result: delRes }, () => {
      expect(deleted.total_deleted).toBeGreaterThanOrEqual(1);
    });
  }, 120000);

  test('Squadrules app: train rejects SPACE_READ_ONLY', async () => {
    if (!serverOk) {
      console.warn('[space-crud] skip app read-only: server unavailable');
      return;
    }
    if (!serverRequiresAuth() || !hasAuthToken()) {
      console.warn('[space-crud] skip app read-only: auth disabled or no token');
      return;
    }
    const why = adapterSpaceSkipReason(bundle, serverOk, 'personal');
    if (why || !bundle) {
      console.warn(`[space-crud] skip app read-only: ${why}`);
      return;
    }
    expect.hasAssertions();
    const { mcp } = bundle;
    const trainCall = {
      name: 'train',
      arguments: {
        content: mdWithTitle(`SpaceCrudAppRO ${Date.now()}`),
        llm_model_id: 'test-space-crud-app-ro',
        space: 'Squadrules app',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    };
    const trainRes = await mcp.client.callTool(trainCall);
    const body = parseMcpJson(trainRes, 'train-crud-app');
    withRawOnFail({ call: trainCall, result: trainRes }, () => {
      expect(body.error).toBe('SPACE_READ_ONLY');
    });
  }, 60000);

  test('move adapter personal → group /shared/ci-test → personal (tune space)', async () => {
    if (!serverOk) {
      console.warn('[space-crud] skip move: server unavailable');
      return;
    }
    if (!serverRequiresAuth() || !hasAuthToken()) {
      console.warn('[space-crud] skip move: auth disabled or no token');
      return;
    }
    assertGroupSpacesWhenAuth(bundle, serverOk);
    expect.hasAssertions();
    const { mcp, groupSpaceName, loadSpacesViaMcp } = bundle;
    if (!groupSpaceName?.includes('ci-test')) {
      throw new Error(
        '[space-crud] expected /shared/ci-test group for move test; run scripts/deploy-configure-keycloak-realms.py'
      );
    }
    const title = `SpaceCrudMove ${Date.now()}`;
    const md = buildSpaceMoveMarkdown(title);

    const trainCall = {
      name: 'train',
      arguments: {
        content: md,
        llm_model_id: 'test-space-crud-move',
        space: 'personal',
        force_update: true,
        review_evidence: MOCK_REVIEW_EVIDENCE
      }
    };
    const trainRes = await mcp.client.callTool(trainCall);
    const trained = parseMcpJson(trainRes, 'train-move-chain');
    expect(trained.status).toBe('stored');
    const adapterUri = trained.items[0].adapter_uri as string;

    await sleepMs(2500);
    let spaces = await loadSpacesViaMcp();
    const id = locationsForAdapterTitle(spaces, title).find((l) => l.type === 'personal')?.adapterId.toLowerCase();
    expect(id).toBeDefined();
    expect(locationsForAdapterTitle(spaces, title).some((l) => l.type === 'personal')).toBe(true);

    const toGroup = {
      name: 'tune',
      arguments: { uris: [adapterUri], space: CI_TEST_SPACE_PARAM }
    };
    const tgRes = await mcp.client.callTool(toGroup);
    const tg = parseMcpJson(tgRes, 'tune-to-group');
    expect(tg.total_updated).toBeGreaterThanOrEqual(1);

    await sleepMs(2500);
    spaces = await loadSpacesViaMcp();
    let loc = locationsForAdapterTitle(spaces, title);
    expect(loc.some((l) => l.type === 'group')).toBe(true);
    expect(loc.find((l) => l.type === 'group')?.adapterId.toLowerCase()).toBe(id);

    const toPersonal = {
      name: 'tune',
      arguments: { uris: [adapterUri], space: 'personal' }
    };
    const tpRes = await mcp.client.callTool(toPersonal);
    const tp = parseMcpJson(tpRes, 'tune-to-personal');
    expect(tp.total_updated).toBeGreaterThanOrEqual(1);

    await sleepMs(2500);
    spaces = await loadSpacesViaMcp();
    loc = locationsForAdapterTitle(spaces, title);
    expect(loc.some((l) => l.type === 'personal')).toBe(true);
    expect(loc.find((l) => l.type === 'personal')?.adapterId.toLowerCase()).toBe(id);

    const delCall = { name: 'delete', arguments: { uris: [adapterUri] } };
    const delRes = await mcp.client.callTool(delCall);
    const deleted = parseMcpJson(delRes, 'delete-move-chain');
    expect(deleted.total_deleted).toBeGreaterThanOrEqual(1);
  }, 180000);
});
