/**
 * Shared harness for the forward / activate effective-content UNIT suites.
 *
 * Honest naming: the record store here is an in-memory double that answers `scrollSpace`
 * — the single record-source method the ancestry walk uses. The graph owner and the logger
 * are module doubles. Real LadybugDB + real LanceDB coverage of the same paths — including
 * the `train`/`tune` writes that produce the records — lives in
 * tests/integration/adapter-inheritance-effective-content.test.ts, and a double is never
 * allowed to stand in for a database there.
 *
 * Mocking strategy mirrors the established pattern: `jest.resetModules()` + both
 * `jest.doMock()` and `jest.unstable_mockModule()`.
 */
import { jest } from '@jest/globals';

import type { Memory } from '../../src/types/memory.js';
import type { ResolvedInheritance, AdapterNode } from '../../src/services/graph-db/graph-database.service.js';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

/** Space every fixture record is stored in — the only scope source. */
export const TEST_SPACE = 'space:unit-forward';

export const mockWarn = jest.fn();
export const mockDebug = jest.fn();
export const mockInfo = jest.fn();
export const mockError = jest.fn();

/**
 * Whether the store has an attached graph. An object rather than a `let` so tests can
 * flip it through an ESM import binding.
 */
export const graphState = { available: false };

export const mockResolveInheritance = jest.fn<any>();

export function graphOwnerFactory() {
  // Graph access is owned by the memory/runtime instance (WeakMap), so the seam is
  // `getGraphDb(store)` — there is no process-global path or singleton here.
  return {
    getGraphDb: (_store: unknown) => {
      if (!graphState.available) return null;
      return {
        isInitialized: () => true,
        resolveInheritance: mockResolveInheritance
      };
    },
    attachGraphDb: jest.fn<any>(),
    detachGraphDb: jest.fn<any>()
  };
}

export function loggerFactory() {
  const loggerDouble = {
    debug: mockDebug,
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
    trace: jest.fn<any>(),
    fatal: jest.fn<any>(),
    child: () => loggerDouble
  };
  return {
    structuredLogger: loggerDouble,
    logger: loggerDouble,
    writeAuditLine: jest.fn<any>()
  };
}

export function registerMocks(): void {
  jest.unstable_mockModule('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.doMock('../../src/services/graph-db/graph-owner.js', graphOwnerFactory);
  jest.unstable_mockModule('../../src/utils/structured-logger.js', loggerFactory);
  jest.doMock('../../src/utils/structured-logger.js', loggerFactory);
}

/** Reset graph availability, the inheritance double and every logger double. */
export function resetGraphState(): void {
  graphState.available = false;
  mockResolveInheritance.mockReset();
  mockWarn.mockClear();
  mockDebug.mockClear();
  mockInfo.mockClear();
  mockError.mockClear();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const CHILD_UUID = 'child-layer-uuid';
export const PARENT_UUID = 'parent-layer-uuid';

/** A comment contract: the cheapest executable contract, so the focus stays on content. */
export function commentContract(text: string): Memory['inference_contract'] {
  return { type: 'comment', required: true, comment: { text } };
}

export interface MemorySpec {
  uuid: string;
  slug: string;
  text: string;
  layerIndex?: number;
  adapterId?: string;
  protocolVersion?: string;
  inherits?: string;
  override?: string[];
  contract?: Memory['inference_contract'];
}

export function makeMemory(spec: MemorySpec): Memory {
  const frontmatter: Record<string, unknown> = {
    slug: spec.slug,
    version: spec.protocolVersion ?? '1.0.0'
  };
  if (spec.inherits) frontmatter['inherits'] = spec.inherits;
  if (spec.override && spec.override.length > 0) frontmatter['override'] = spec.override;

  return {
    memory_uuid: spec.uuid,
    label: spec.slug,
    slug: spec.slug,
    // Scope of the stored record — resolution must use this, not a guess.
    space_id: TEST_SPACE,
    tags: [],
    text: spec.text,
    llm_model_id: 'test-model',
    created_at: '2026-01-01T00:00:00Z',
    adapter: {
      id: spec.adapterId ?? spec.uuid,
      name: spec.slug,
      layer_index: spec.layerIndex ?? 1,
      layer_count: 1,
      ...(spec.protocolVersion ? { protocol_version: spec.protocolVersion } : {}),
      frontmatter
    },
    ...(spec.contract ? { inference_contract: spec.contract } : {})
  };
}

/**
 * The record source the resolver reads: `scrollSpace(spaceId)` over an in-memory list.
 *
 * This is the whole contract — `resolveStoredAdapterSnapshot` and
 * `resolveStoredAdapterLayers` only call this one method — so the double cannot hide a
 * behaviour the production source has.
 */
export function makeSource(records: Memory[]) {
  return {
    scrollSpace: async (spaceId: string) =>
      records
        .filter((record) => record.space_id === spaceId)
        .map((record) => ({ uuid: record.memory_uuid, payload: record }))
  };
}

export function adapterNode(slug: string, version = '1.0.0'): AdapterNode {
  return {
    key: `adapter:${TEST_SPACE}:${slug}`,
    type: 'adapter',
    slug,
    version,
    title: slug,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  };
}

/** A graph resolution for `childSlug` with the given resolved properties. */
export function makeResolved(
  childSlug: string,
  resolvedProperties: Record<string, unknown> = {}
): ResolvedInheritance {
  const childNode = adapterNode(childSlug);
  return {
    adapter: childNode,
    resolved_properties: { ...childNode, ...resolvedProperties },
    inheritance_chain: []
  };
}

/** Child adapter layer: inherits `parent-adapter`, and carries its own additions. */
export function makeChildMemory(slug = 'child-adapter'): Memory {
  return makeMemory({
    uuid: CHILD_UUID,
    slug,
    text: '## Rules\n\nChild rules: review the diff first.\n\n## Additions\n\nChild-only addition.',
    protocolVersion: '1.0.0',
    inherits: 'parent-adapter',
    contract: commentContract('child contract')
  });
}

/** Parent adapter layer: one section the child overrides, one the child does not claim. */
export function makeParentMemory(slug = 'parent-adapter'): Memory {
  return makeMemory({
    uuid: PARENT_UUID,
    slug,
    adapterId: 'parent-adapter-id',
    text: '## Policy\n\nParent policy: review schema changes.\n\n## Rules\n\nParent rules: never reached.',
    protocolVersion: '2.0.0',
    contract: commentContract('parent contract')
  });
}
