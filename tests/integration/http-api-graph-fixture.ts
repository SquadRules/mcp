/**
 * Real-HTTP fixture for the in-process graph suites (ADR 0042–0047).
 *
 * Every component is a production object over an ephemeral listener — nothing in
 * the request path is replaced:
 *
 *   - `openGraphDb({ databaseDir })` — real embedded LadybugDB at an explicit dir.
 *   - `LanceVectorRecordStore({ databaseDir })` — real embedded LanceDB.
 *   - `createEmbeddedRuntime(records)` — binds one store to both tool facades.
 *   - `startHttpServer(0, memoryStore, qdrantService)` — the production Express app
 *     (middleware, auth, routes, MCP handler) on an OS-assigned port, so the suites
 *     hit the same router the server exposes.
 *   - `AUTH_ENABLED=false` — the production single-tenant request context
 *     (`defaultSpaceContext()`), which is what an auth-disabled deployment uses.
 *
 * Embeddings: this fixture selects the `tei` provider with no `TEI_BASE_URL`, exactly
 * like the other embedded graph fixtures. Real ONNX must not run inside a Jest vm
 * realm (ADR 0004: fastembed's ONNX `Float32Array instanceof` guard throws across
 * realms) and a fake provider is not allowed, so vector-*dependent* assertions (search,
 * activate, merged content) live in `http-api-graph-api.test.ts`, which drives the
 * shipped server in a child process. Writes here take the store's documented
 * zero-vector fallback — production behaviour under an embedding failure.
 *
 * Review gate (recorded, not bypassed). `executeTrain` exempts exactly two real
 * contracts from `review_evidence`: artifact trains (non-markdown mime) and fork
 * trains (`source_adapter_uri`). These suites never fabricate a critic PASS. The
 * fixture seeds ONE bundled adapter through the app-space `storeAdapter` call that
 * `injectMemResourcesAtBoot` makes (system seeding, not an author train), and every
 * *authored* write below is a fork train of that real seeded source.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { MemoryQdrantStore } from '../../src/services/memory/store.js';
import type { QdrantService } from '../../src/services/qdrant/service.js';
import type { SpaceContext } from '../../src/utils/tenant-context.js';
import type { GraphRepository } from '../../src/services/graph-db/graph-repository.js';
import { loadProductionModules, type ProductionModules, type Runtime } from './graph-db-fixture.js';

type HttpServerModule = typeof import('../../src/http/http-server.js');
type MemDirModule = typeof import('../../src/resources/mem-dir-utils.js');

/** Production modules the HTTP suites share, imported after the env is applied. */
export interface HttpModules extends ProductionModules {
  http: HttpServerModule;
  memDir: MemDirModule;
}

export interface HttpRuntime extends Runtime {
  /** `http://127.0.0.1:<ephemeral port>` for this runtime's own listener. */
  baseUrl: string;
  server: Server;
  /** Stop this runtime's listener (graph + store stay open for post-close asserts). */
  closeServer(): Promise<void>;
}

export interface HttpReply {
  status: number;
  body: Record<string, unknown>;
}

/** Response of one `POST /api/train` fork write. */
export interface ForkResult {
  reply: HttpReply;
  slug: string;
  adapterUri: string;
  layerUuid: string;
}

const BUNDLED_SOURCE_SLUG = 'critic-loop';

/**
 * Load the production modules for an auth-disabled HTTP server backed by an
 * explicit graph + Lance directory. The suite runs in its own Jest module
 * registry and neither this fixture nor `graph-db-fixture` has any non-type
 * `src/**` import, so the env below is what the freshly imported modules see.
 */
export async function loadHttpModules(memRoot: string): Promise<HttpModules> {
  const base = await loadProductionModules({
    // ADR 0004: no ONNX in a Jest vm realm, and no fake provider either. Vector-free
    // assertions stay in-process; vector-dependent ones run against the child server.
    EMBEDDING_PROVIDER: 'tei',
    AUTH_ENABLED: 'false',
    SQUADRULES_GRAPH_DB_PATH: join(memRoot, 'graph-root'),
    SQUADRULES_INHERITANCE_CHECKPOINT_DIR: join(memRoot, 'checkpoints'),
    SQUADRULES_GRAPH_DB_ENABLED: 'true'
  });
  const http = await import('../../src/http/http-server.js');
  const memDir = await import('../../src/resources/mem-dir-utils.js');
  return { ...base, http, memDir };
}

/** Owns temp dirs, listeners, graphs and the production calls the suites make. */
export class HttpGraphFixture {
  private readonly tempDirs: string[] = [];
  private readonly runtimes: HttpRuntime[] = [];
  /** One seeded bundled source adapter per runtime, created on first fork. */
  private readonly seeded = new WeakSet<HttpRuntime>();

  constructor(readonly modules: HttpModules) {}

  /** Real, suite-unique temp directory removed by `dispose()`. */
  tempDir(label: string): string {
    const dir = mkdtempSync(join(tmpdir(), `squadrules-http-${label}-`));
    this.tempDirs.push(dir);
    return dir;
  }

  /** Open a real graph + record store + Express listener on an ephemeral port. */
  async openRuntime(label: string): Promise<HttpRuntime> {
    const dir = this.tempDir(`rt-${label}`);
    const graph: GraphRepository | null = await this.modules.graphSingleton.openGraphDb({
      databaseDir: join(dir, 'graph')
    });
    if (!graph) throw new Error(`graph backend did not open for runtime ${label}`);
    const records = new this.modules.lanceStore.LanceVectorRecordStore({
      databaseDir: join(dir, 'records')
    });
    await records.init();
    const bound = this.modules.embeddedRuntime.createEmbeddedRuntime(records);
    this.modules.owner.attachGraphDb(graph, bound.memoryStore);

    const server = this.modules.http.startHttpServer(0, bound.memoryStore, bound.qdrantService);
    await new Promise<void>((resolve, reject) => {
      if (server.listening) return resolve();
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    const runtime: HttpRuntime = {
      label,
      graph,
      dirs: { graph: join(dir, 'graph'), records: join(dir, 'records') },
      records,
      memoryStore: bound.memoryStore,
      qdrantService: bound.qdrantService,
      baseUrl: `http://127.0.0.1:${address.port}`,
      server,
      closeServer: async () => {
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    };
    this.runtimes.push(runtime);
    return runtime;
  }

  /** Production space context for this runtime's writable (personal) space. */
  personalContext(runtime: HttpRuntime): SpaceContext {
    const ctx = this.modules.tenant.getSpaceContextFromStorage();
    void runtime;
    return ctx;
  }

  /** Real HTTP POST against one runtime's own listener. */
  async post(runtime: HttpRuntime, path: string, body: unknown): Promise<HttpReply> {
    const res = await fetch(`${runtime.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await readJson(res) };
  }

  /** Real HTTP GET against one runtime's own listener. */
  async get(runtime: HttpRuntime, path: string): Promise<HttpReply> {
    const res = await fetch(`${runtime.baseUrl}${path}`);
    return { status: res.status, body: await readJson(res) };
  }

  /**
   * Seed ONE bundled adapter into the app space, exactly as `injectMemResourcesAtBoot`
   * does (`memoryStore.storeAdapter([markdown], 'system-boot', { forceUpdate: true })`
   * inside the app-space context). This is the real fork source the fork exemption
   * requires; it is a system seed, never an authored train.
   */
  async seedBundledSource(runtime: HttpRuntime): Promise<string> {
    if (this.seeded.has(runtime)) return bundledSourceUri();
    const files = await this.modules.memDir.readMemFiles(this.modules.memDir.getMemDir());
    const markdown = files[BUNDLED_SOURCE_SLUG];
    if (!markdown) throw new Error(`bundled mem file ${BUNDLED_SOURCE_SLUG}.md is missing`);
    const appSpaceId = this.modules.appSpaceId;
    const appContext: SpaceContext = {
      userId: '',
      groupIds: [],
      allowedSpaceIds: [appSpaceId],
      defaultWriteSpaceId: appSpaceId,
      personalSpaceId: '',
      spaceNamesById: {}
    };
    await this.modules.tenant.runWithSpaceContextAsync(appContext, () =>
      runtime.memoryStore.storeAdapter([markdown], 'system-boot', { forceUpdate: true })
    );
    this.seeded.add(runtime);
    return bundledSourceUri();
  }

  /** Author one adapter over real HTTP through the fork exemption. */
  async forkTrain(runtime: HttpRuntime, markdown: string): Promise<ForkResult> {
    const source = await this.seedBundledSource(runtime);
    const reply = await this.post(runtime, '/api/train', {
      content: markdown,
      source_adapter_uri: source,
      llm_model_id: 'it-http-graph',
      force_update: true
    });
    const items = (reply.body['items'] as Array<Record<string, unknown>> | undefined) ?? [];
    const first = items[0] ?? {};
    const adapterUri = typeof first['adapter_uri'] === 'string' ? first['adapter_uri'] : '';
    const layerUuid = typeof first['layer_uuid'] === 'string' ? first['layer_uuid'] : '';
    return { reply, slug: slugFromUri(adapterUri), adapterUri, layerUuid };
  }

  /** Real `POST /api/export` for one adapter URI (current head unless `version`). */
  async exportMarkdown(
    runtime: HttpRuntime,
    uri: string,
    version?: string
  ): Promise<HttpReply> {
    return this.post(runtime, '/api/export', {
      uri,
      format: 'markdown',
      ...(version !== undefined ? { version } : {})
    });
  }

  /** Store facade for a runtime (used only for read-back assertions). */
  store(runtime: HttpRuntime): MemoryQdrantStore {
    return runtime.memoryStore;
  }

  /** Qdrant facade for a runtime (used only for read-back assertions). */
  service(runtime: HttpRuntime): QdrantService {
    return runtime.qdrantService;
  }

  /** Close every listener, graph and temp dir this fixture created. */
  async dispose(): Promise<void> {
    for (const runtime of this.runtimes) {
      try {
        await runtime.closeServer();
      } catch {
        // A suite that exercised close() already released the listener.
      }
      try {
        await runtime.graph.close();
      } catch {
        // Same reason.
      }
    }
    this.runtimes.length = 0;
    for (const dir of this.tempDirs) rmSync(dir, { recursive: true, force: true });
    this.tempDirs.length = 0;
    delete process.env['EMBEDDING_PROVIDER'];
  }
}

function bundledSourceUri(): string {
  return `squadrules://adapter/${BUNDLED_SOURCE_SLUG}`;
}

function slugFromUri(uri: string): string {
  const marker = 'squadrules://adapter/';
  return uri.startsWith(marker) ? uri.slice(marker.length) : '';
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (text.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { raw: text };
  }
}
