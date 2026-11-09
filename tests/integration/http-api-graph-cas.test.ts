/**
 * HTTP tune — the compare-and-swap guard a caller asked for is the guard that runs.
 *
 * Two regressions are pinned here, both at the wire:
 *   1. `expected_version` on a **layer** URI was dropped by the dispatcher, so the write
 *      went through unguarded while the caller believed it was protected.
 *   2. A real conflict reached HTTP clients as `200` prose: the code and the compared
 *      versions were flattened into `message`, leaving nothing to branch on.
 *
 * Every component is production: the Express app on an ephemeral port, a real embedded
 * LadybugDB, a real LanceDB record store, and real `executeTune` behind the route.
 *
 * Seeding, recorded rather than waived: the fixture system-seeds the bundled `critic-loop`
 * adapter into the app space exactly as boot injection does, and the authored write is a
 * fork train (`source_adapter_uri`) — one of the two real `review_evidence` exemptions.
 *
 * Review evidence, stated plainly: this suite fabricates no verdict. A content tune needs a
 * PASS from a real critic-loop delegation, which a test run cannot produce, so the content
 * case below proves the gate's *refusal* path and nothing more. A successful content write,
 * a content `VERSION_CONFLICT`, and a restore stay unverified here until a run supplies
 * genuine critic evidence.
 */
import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HttpGraphFixture,
  loadHttpModules,
  type HttpModules,
  type HttpRuntime
} from './http-api-graph-fixture.js';
import { adapterDocument, twoLayerDocument } from './http-api-graph-cas-docs.js';

jest.setTimeout(180_000);

const SLUG = 'http-cas-adapter';
const VERSION = '1.0.0';
const STALE = '9.9.9';
const UNKNOWN_LAYER_URI = 'squadrules://layer/00000000-0000-4000-8000-000000000000';

let modules: HttpModules;
let fixture: HttpGraphFixture;
let runtime: HttpRuntime;
let adapterUri: string;
let layerUri: string;
let layerUuid: string;
let historyKey: string;

/** Stored payload of one row, read through the same surface the tools read. */
async function storedPayload(uuid: string): Promise<Record<string, unknown>> {
  const point = await runtime.qdrantService.retrieveById(uuid);
  if (!point) throw new Error(`stored row ${uuid} is not readable`);
  return point.payload as Record<string, unknown>;
}

/** First result row of an `/api/tune` reply. */
function firstRow(body: Record<string, unknown>): Record<string, any> {
  const rows = (body['results'] as Array<Record<string, any>> | undefined) ?? [];
  const row = rows[0];
  if (!row) throw new Error(`no result row in ${JSON.stringify(body)}`);
  return row;
}

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'squadrules-http-cas-'));
  modules = await loadHttpModules(root);
  fixture = new HttpGraphFixture(modules);
  runtime = await fixture.openRuntime('cas');

  const created = await fixture.forkTrain(runtime, adapterDocument('cas-step-body'));
  if (created.reply.status !== 200) {
    throw new Error(`fork train failed: ${JSON.stringify(created.reply)}`);
  }
  expect(created.slug).toBe(SLUG);

  adapterUri = created.adapterUri;
  layerUuid = created.layerUuid;
  layerUri = `squadrules://layer/${layerUuid}`;

  // `VERSION` is read back from the stored head, not assumed. Every CAS assertion below
  // compares against it, so if the fixture document's `version:` ever changes this fails
  // here instead of leaving behind tests that compare against a version nothing stores.
  const headPayload = await storedPayload(layerUuid);
  const headAdapter = (headPayload['adapter'] ?? {}) as Record<string, unknown>;
  const headFrontmatter = (headAdapter['frontmatter'] ?? {}) as Record<string, unknown>;
  const headProtocolVersion = headAdapter['protocol_version'];
  const headFrontmatterVersion = headFrontmatter['version'];
  const storedVersion =
    typeof headProtocolVersion === 'string' && headProtocolVersion.trim().length > 0
      ? headProtocolVersion.trim()
      : typeof headFrontmatterVersion === 'string'
        ? headFrontmatterVersion.trim()
        : '0.0.0';
  expect(storedVersion).toBe(VERSION);

  // The graph key is derived from the space the write actually landed in, not from a
  // context default: a suite that guessed the wrong space would read an empty history and
  // its "appends nothing / appends one" assertions would stop proving anything.
  const storedSpaceId = headPayload['space_id'];
  expect(typeof storedSpaceId === 'string' && storedSpaceId.length > 0).toBe(true);
  historyKey = modules.scope.adapterGraphKey(String(storedSpaceId), SLUG);
});

afterAll(async () => {
  await fixture?.dispose();
});

describe('a layer URI is guarded, not silently written', () => {
  test('a stale expected_version fails the row and leaves the stored bytes untouched', async () => {
    const before = await storedPayload(layerUuid);

    const reply = await fixture.post(runtime, '/api/tune', {
      uris: [layerUri],
      updates: { tags: ['cas-must-not-apply'] },
      expected_version: STALE
    });

    expect(reply.status).toBe(200);
    expect(reply.body['total_updated']).toBe(0);
    expect(reply.body['total_failed']).toBe(1);

    const row = firstRow(reply.body);
    expect(row['status']).toBe('error');
    expect(row['error']).toEqual({
      code: 'VERSION_CONFLICT',
      target: layerUri,
      expected: STALE,
      current: VERSION
    });
    // The prose stays for humans and for the callers that already match on it.
    expect(String(row['message'])).toContain('VERSION_CONFLICT');

    expect(await storedPayload(layerUuid)).toEqual(before);
  });

  test('the same layer URI applies the update when the version matches', async () => {
    const reply = await fixture.post(runtime, '/api/tune', {
      uris: [layerUri],
      updates: { tags: ['cas-allowed'] },
      expected_version: VERSION
    });

    expect(reply.status).toBe(200);
    expect(reply.body['total_updated']).toBe(1);
    expect(reply.body['total_failed']).toBe(0);
    expect(firstRow(reply.body)['error']).toBeUndefined();
    expect((await storedPayload(layerUuid))['tags']).toEqual(['cas-allowed']);
  });

  test('a layer URI with no stored row is rejected as unsupported, never written', async () => {
    const reply = await fixture.post(runtime, '/api/tune', {
      uris: [UNKNOWN_LAYER_URI],
      updates: { tags: ['never'] },
      expected_version: VERSION
    });

    expect(reply.status).toBe(200);
    expect(reply.body['total_updated']).toBe(0);
    expect(reply.body['total_failed']).toBe(1);

    const row = firstRow(reply.body);
    expect(row['status']).toBe('error');
    expect(row['error']).toEqual({
      code: 'VERSION_GUARD_UNSUPPORTED',
      target: UNKNOWN_LAYER_URI,
      expected: VERSION,
      reason: 'layer_not_found'
    });
    expect(String(row['message'])).toContain('VERSION_GUARD_UNSUPPORTED');
    expect(await runtime.qdrantService.retrieveById(UNKNOWN_LAYER_URI.split('/').pop()!)).toBeNull();
  });

  test('a layer update without expected_version keeps ordinary tune behavior', async () => {
    const reply = await fixture.post(runtime, '/api/tune', {
      uris: [layerUri],
      updates: { tags: ['plain-update'] }
    });

    expect(reply.status).toBe(200);
    expect(reply.body['total_updated']).toBe(1);
    expect(firstRow(reply.body)['error']).toBeUndefined();
    expect((await storedPayload(layerUuid))['tags']).toEqual(['plain-update']);
  });
});

describe('the other two write paths are guarded as well', () => {
  test('an adapter URI with updates is guarded on its head, and a stale guard writes nothing', async () => {
    const before = await storedPayload(layerUuid);

    const stale = await fixture.post(runtime, '/api/tune', {
      uris: [adapterUri],
      updates: { tags: ['adapter-guard-must-not-apply'] },
      expected_version: STALE
    });

    expect(stale.status).toBe(200);
    expect(stale.body['total_updated']).toBe(0);
    expect(stale.body['total_failed']).toBe(1);
    expect(firstRow(stale.body)['error']).toEqual({
      code: 'VERSION_CONFLICT',
      target: adapterUri,
      expected: STALE,
      current: VERSION
    });
    expect(await storedPayload(layerUuid)).toEqual(before);

    const allowed = await fixture.post(runtime, '/api/tune', {
      uris: [adapterUri],
      updates: { tags: ['adapter-guard-allowed'] },
      expected_version: VERSION
    });

    expect(allowed.status).toBe(200);
    expect(allowed.body['total_updated']).toBe(1);
    expect(firstRow(allowed.body)['error']).toBeUndefined();
    expect((await storedPayload(layerUuid))['tags']).toEqual(['adapter-guard-allowed']);
  });

  test('a move-only tune is guarded before it reassigns any layer', async () => {
    const before = await storedPayload(layerUuid);

    const reply = await fixture.post(runtime, '/api/tune', {
      uris: [layerUri],
      space: 'personal',
      expected_version: STALE
    });

    expect(reply.status).toBe(200);
    expect(reply.body['total_updated']).toBe(0);
    expect(reply.body['total_failed']).toBe(1);
    expect(firstRow(reply.body)['error']).toEqual({
      code: 'VERSION_CONFLICT',
      target: layerUri,
      expected: STALE,
      current: VERSION
    });
    expect(await storedPayload(layerUuid)).toEqual(before);
  });
});

describe('a layer cannot borrow a version from a head outside its own space', () => {
  test('a stranded tail is refused, never guarded by a non-head or a foreign head', async () => {
    // Direct store setup, no mocks: author a real two-layer adapter through the fork-train
    // exemption, then move only its head to the app space — the state a space reassignment
    // leaves behind when it stops between layer writes (`reassignAdapterLayersToSpace`
    // updates the layers one at a time and has no transaction). The tail now sits in a
    // space whose only layer is the tail itself.
    const strand = await fixture.forkTrain(runtime, twoLayerDocument('Http Cas Strand Adapter'));
    expect(strand.reply.status).toBe(200);

    const headPayloadBeforeMove = await storedPayload(strand.layerUuid);
    const adapterId = (headPayloadBeforeMove['adapter'] as Record<string, unknown> | undefined)?.['id'];
    expect(typeof adapterId).toBe('string');

    const layers = await runtime.qdrantService.getAdapterLayers(String(adapterId));
    const head = layers.find((row) => row.payload?.adapter?.layer_index === 1);
    const tail = layers.find((row) => row.payload?.adapter?.layer_index === 2);
    if (!head || !tail) throw new Error(`two-layer adapter stored ${layers.length} layer(s)`);
    expect(head.uuid).toBe(strand.layerUuid);

    const strandSpaceId = typeof headPayloadBeforeMove['space_id'] === 'string' ? headPayloadBeforeMove['space_id'] : '';
    expect(strandSpaceId.length).toBeGreaterThan(0);
    expect(strandSpaceId).not.toBe(modules.appSpaceId);

    await runtime.qdrantService.updateMemory(head.uuid, { space_id: modules.appSpaceId });
    expect((await storedPayload(head.uuid))['space_id']).toBe(modules.appSpaceId);

    const tailBefore = await storedPayload(tail.uuid);
    const tailUri = `squadrules://layer/${tail.uuid}`;
    const reply = await fixture.post(runtime, '/api/tune', {
      uris: [tailUri],
      updates: { tags: ['stranded-must-not-apply'] },
      expected_version: VERSION
    });

    // Fail closed: the tail has no same-space head to compare against, so the guard refuses
    // rather than promoting the tail (or the app-space head) to "the version".
    expect(reply.status).toBe(200);
    expect(reply.body['total_updated']).toBe(0);
    expect(reply.body['total_failed']).toBe(1);
    expect(firstRow(reply.body)['error']).toEqual({
      code: 'VERSION_GUARD_UNSUPPORTED',
      target: tailUri,
      expected: VERSION,
      reason: 'adapter_head_missing'
    });
    expect(await storedPayload(tail.uuid)).toEqual(tailBefore);
  });
});

describe('a content tune cannot reach the CAS without critic evidence', () => {
  test('the review gate refuses the write and leaves head bytes and history untouched', async () => {
    const exported = await fixture.exportMarkdown(runtime, adapterUri);
    expect(exported.status).toBe(200);
    const current = String(exported.body['content']);
    const refused = current.replace('Done.', 'Body that must never be stored without a critic verdict.');
    expect(refused).not.toBe(current);

    const historyBefore = await runtime.graph.listVersions(historyKey);

    const reply = await fixture.post(runtime, '/api/tune', {
      uris: [adapterUri],
      content: [refused],
      expected_version: VERSION
    });

    // The production gate answers before the dispatcher runs: a content tune without
    // `review_evidence` is a rejected request, never a write that silently drops its guard.
    // Because the refusal precedes the CAS, a content `VERSION_CONFLICT` is not observable
    // here — proving one needs a PASS verdict from a real critic delegation.
    expect(reply.status).toBe(400);
    expect(reply.body['error']).toBe('INVALID_INPUT');
    expect(String(reply.body['message'])).toContain('review_evidence');

    // Nothing reached a layer: the head stays byte-identical and history appends nothing.
    expect(String((await fixture.exportMarkdown(runtime, adapterUri)).body['content'])).toBe(current);
    const historyAfter = await runtime.graph.listVersions(historyKey);
    expect(historyAfter.map((row) => row.version_number).sort()).toEqual(
      historyBefore.map((row) => row.version_number).sort()
    );
  });
});
