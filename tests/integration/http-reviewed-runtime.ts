/*
 * TASK-BOUND PROOF HARNESS — NOT a portable CI lane.
 *
 * Every path, pin and scope below is bound to ONE verified worktree
 * (`http-reviewed-evidence.ts` hard-codes the absolute WT). This file is not a
 * lane a CI job can pick up: it needs a granted serial slot, a coordinator-authored
 * bootstrap-delta packet, a complete on-disk model cache and two runtime-bound
 * judgments. Treat it as retained proof material for this task, not as a reusable
 * suite. It is also never imported in a Jest/VM realm.
 *
 * PREFLIGHT COST DESIGN (bounded, measured, recorded).
 *
 *   bootstrap (once)      1 isolation `verify` + 1 full-source inventory (packet
 *                         binding) + 1 model-cache declaration check + 3 real
 *                         byte passes over the required cache files (declared
 *                         source, pre-copy re-hash, post-copy re-verify) + 1 copy.
 *   mutation preflight    1 isolation `verify` + AT MOST 1 full-source inventory,
 *                         whose digest is threaded into every nested packet check
 *                         in that same preflight — never recomputed per file.
 *   evidence write        0 isolation runs, 0 inventories. A `record`/`recordBytes`
 *                         call only re-asserts containment under the owned runtime
 *                         directory and `wx` (never overwrites) — it is bracketed by
 *                         mutation preflights and carries their measured cost, so a
 *                         POST cannot multiply the expensive traversal.
 *
 * Each preflight records `{verifies, inventories, verifyMs, inventoryMs,
 * filesHashed, bytesHashed}` so the claim above is auditable from the retained
 * evidence rather than asserted in prose.
 *
 * KNOWN ACCOUNTING LIMITATION (disclosed; what is left outside the counters).
 * The bootstrap counters DO charge all three cache byte passes and both legs of the
 * copy: `modelCacheBytes`/`modelCacheMs` (declared source), `modelCopyBytes`/
 * `modelCopyMs` (the pre-copy re-hash read plus the `copyFileSync` write) and
 * `modelReverifyBytes`/`modelReverifyMs` (post-copy re-verify). `verifyRuntime()` is
 * always handed the preflight's threaded inventory, so the one-traversal budget below
 * holds: no packet check re-walks `src/` on its own. What remains UNCOUNTED in every
 * preflight is `initialEvidence()` — its 27 input/source/capture pin rehashes plus
 * the verdict and four capture-file re-reads — together with `independentPacket()`'s
 * artifact/verdict/capture re-reads and the 23 KB SDK text read by `sdkModelRule()`.
 * `filesHashed`/`bytesHashed` still measure ONLY the source-inventory traversal, so
 * the totals understate real per-preflight I/O by those terms. This is reported
 * rather than silently absorbed.
 */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assertCompleteModelCache, bootstrapPacketRequirements, checkHash, DELTA, independentPacket,
  initialEvidence, ownedPath, physical, sdkCachePlacement, sha, SLUG, sourceInventory, TARGET, TASK,
  verifyModelCacheOnDisk, verifyTask, WT, type SourceInventory
} from './http-reviewed-evidence.js';

/**
 * One preflight's measured spend. `verifies` counts isolation-verifier runs and
 * `inventories` counts full-source traversals; both are budgeted at 1 per
 * preflight and the budget is asserted, not just documented. `filesHashed` and
 * `bytesHashed` cover the inventory traversal ONLY; the model-cache byte passes and
 * the copy have their own byte/duration pairs below. `initialEvidence()`'s
 * pin/verdict/capture re-reads stay outside every counter (see the known accounting
 * limitation in this file's header).
 */
export interface PreflightCost {
  phase: string;
  verifies: number;
  inventories: number;
  /** Declared-source byte pass: `verifyModelCacheOnDisk` over `model_cache.source`. */
  modelCacheBytes: number;
  /**
   * BOTH copy-phase legs, each charged the cache payload once: the pre-copy re-hash
   * read and the `copyFileSync` write. Charging one leg would understate the phase by
   * half, which is what the header's "pre-copy re-hash plus the copy" claim means.
   */
  modelCopyBytes: number;
  /** Post-copy byte pass: `verifyModelCacheOnDisk` re-reading the owned copy. */
  modelReverifyBytes: number;
  evidenceWrites: number;
  verifyMs: number;
  inventoryMs: number;
  modelCacheMs: number;
  /** Pre-copy re-read/hash plus the copy itself (bootstrap only). */
  modelCopyMs: number;
  /** The post-copy re-verify pass (bootstrap only). */
  modelReverifyMs: number;
  filesHashed: number;
  bytesHashed: number;
}

function emptyCost(phase: string): PreflightCost {
  return {
    phase, verifies: 0, inventories: 0, modelCacheBytes: 0, modelCopyBytes: 0, modelReverifyBytes: 0,
    evidenceWrites: 0, verifyMs: 0, inventoryMs: 0, modelCacheMs: 0, modelCopyMs: 0,
    modelReverifyMs: 0, filesHashed: 0, bytesHashed: 0
  };
}

/** Counted isolation verifier run; at most one per preflight. */
function budgetedVerify(cost: PreflightCost): void {
  assert(cost.verifies < 1, `preflight ran more than one isolation verifier pass: ${cost.phase}`);
  const started = performance.now();
  verifyTask();
  cost.verifies += 1;
  cost.verifyMs = Math.round((performance.now() - started) * 1000) / 1000;
}

/** Counted full-source inventory pass; at most one per preflight. */
function budgetedInventory(cost: PreflightCost): SourceInventory {
  assert(cost.inventories < 1, `preflight ran more than one source inventory pass: ${cost.phase}`);
  const inventory = sourceInventory();
  cost.inventories += 1;
  cost.inventoryMs = inventory.milliseconds;
  cost.filesHashed = inventory.files_hashed;
  cost.bytesHashed = inventory.bytes_hashed;
  return inventory;
}

/**
 * Evidence that the recorded base URL is a real loopback-only production bind.
 * `address`/`family` are read back from `server.address()` AFTER binding, so they
 * report the interface the kernel actually accepted — not the host we asked for.
 */
export interface LoopbackBinding {
  host: '127.0.0.1'; address: string; family: string; port: number; baseUrl: string; wildcard: false;
}

/** The bootstrap-packet shape this run requires, restated into retained evidence. */
type BootstrapRequirements = ReturnType<typeof bootstrapPacketRequirements>;

/**
 * Independently measured proof that the selected supported-model cache was
 * complete AND that the owned copy sits where the SDK will actually read it.
 * `resolved_model_dir`/`resolved_files` are absolute paths derived from the SDK's
 * own `path.join`, so the coordinator can fill `model_cache.source` from evidence
 * instead of guessing the root/model-directory split.
 *
 * NAME COLLISION GUARD. `bootstrap_packet_requirements.model_cache.sdk_reads_only`
 * is the model directory inside the DECLARED SOURCE root; the field below is the
 * model directory inside the OWNED COPY. Both are written side by side into the same
 * `boot.json`, so the owned one is named `owned_model_dir` — never `sdk_reads_only` —
 * and no consumer can copy the wrong path into `model_cache.source`.
 */
interface ModelCacheEvidence {
  source: string; model_directory: string; required_files: string[];
  files_sha256: Record<string, string>; files: number; bytes: number; milliseconds: number;
  sdk: any; sdk_directory_rule: string; owned_model_dir: string;
  resolved_model_dir: string;
  resolved_files: { relative: string; absolute: string; bytes: number; sha256: string }[];
  copied_to: string; copied_files: number;
}

export class ReviewedRuntime {
  private constructor(
    readonly dir: string, readonly bootstrapPath: string, readonly bootstrapPin: string,
    readonly modules: any, readonly records: any, readonly boot: any,
    readonly server: Server, readonly baseUrl: string, readonly context: any,
    readonly actor: any, readonly key: string,
    readonly listener: LoopbackBinding, readonly requirements: BootstrapRequirements,
    readonly modelCache: ModelCacheEvidence, readonly costs: PreflightCost[],
    private lastInventory: SourceInventory
  ) {}

  /** Counted evidence writes. These must never drive a verifier or inventory pass. */
  private writes = 0;
  get writeCount(): number { return this.writes; }
  /** The one source snapshot the current preflight measured. */
  get inventory(): SourceInventory { return this.lastInventory; }

  static async start(): Promise<ReviewedRuntime> {
    // Whole-bootstrap budget: exactly one isolation verifier pass, one source inventory.
    const cost = emptyCost('bootstrap');
    budgetedVerify(cost);
    const evidence = initialEvidence();
    assert.equal(process.env.HTTP_REVIEWED_EXECUTION_SLOT, 'granted', 'BLOCKED: no integration/native/model slot');
    assert(!process.env.NODE_OPTIONS, 'plain source entry must not inherit NODE_OPTIONS');
    assert(process.execArgv.some(a => a.includes('transpile-only.mjs')), 'plain-Node ts-node source loader required');
    const bootstrapPath = process.env.HTTP_REVIEWED_BOOTSTRAP_FILE ?? '';
    const bootstrapPin = process.env.HTTP_REVIEWED_BOOTSTRAP_SHA256 ?? '';
    const inventory = budgetedInventory(cost);
    const p = independentPacket(bootstrapPath, bootstrapPin, 'bootstrap-delta', sha(DELTA), inventory);
    assert.equal(p.target_uri, TARGET);
    assert.equal(p.delta, DELTA);

    // Prerequisite A2 — COMPLETE supported-model cache, proven from the installed SDK
    // BEFORE any production/model import. No download, no init, no probe, no substitute.
    const cache = p.model_cache;
    const requirement = assertCompleteModelCache(cache);
    // D3: resolve the paths the SDK itself will read. `retrieveModel` joins the repo
    // name onto cacheDir, so the cache ROOT is never read for files — verifying the
    // root alone would prove nothing. The listing rule (exactly the required entries)
    // and the byte/digest/regular-file rules now live in verifyModelCacheOnDisk, at
    // the SDK-resolved model directory.
    const sourcePlacement = sdkCachePlacement(cache.source, requirement);
    const cacheCost = verifyModelCacheOnDisk(cache.source, requirement, cache.files_sha256);
    cost.modelCacheBytes = cacheCost.bytes;
    cost.modelCacheMs = cacheCost.milliseconds;
    assert.equal(cacheCost.model_dir, sourcePlacement.modelDir,
      'declared source cache is not at the SDK-resolved model directory');
    const requirements = bootstrapPacketRequirements(cache, requirement);

    ownedPath(join(WT, '.local/http-reviewed-run-'));
    const dir = mkdtempSync(join(WT, '.local/http-reviewed-run-'));
    console.log(JSON.stringify({ runtimeDirectory: dir, bootstrapSha256: bootstrapPin }));
    const paths: Record<string, string> = {};
    for (const name of ['home', 'squadrules', 'cache', 'model-cache', 'tmp', 'config', 'data', 'artifacts', 'checkpoints']) {
      paths[name] = join(dir, name);
      ownedPath(paths[name]!); mkdirSync(paths[name]!);
    }
    // Copy ONLY the SDK-required files (read-only source) into the owned throwaway
    // cache, at the SDK-NATIVE layout `<owned cache root>/<repo with "/" -> "_">/`.
    // Convention D3(a): FASTEMBED_CACHE_DIR is the owned cache ROOT, and the SDK's own
    // path.join(FASTEMBED_CACHE_DIR, repo.replace("/", "_")) resolves onto the exact
    // directory these files are copied into — the same join re-asserted at the env
    // boundary below. Files are copied flat into the root by nobody, anywhere.
    const ownedCacheRoot = paths['model-cache']!;
    const ownedPlacement = sdkCachePlacement(ownedCacheRoot, requirement);
    const modelCache: ModelCacheEvidence = {
      source: cache.source, model_directory: requirement.modelDirectory, required_files: requirement.files,
      files_sha256: cacheCost.files_sha256, bytes: cacheCost.bytes, files: cacheCost.files,
      milliseconds: cacheCost.milliseconds, sdk: requirement.sdk,
      sdk_directory_rule: requirement.sdk.directory_rule, owned_model_dir: ownedPlacement.modelDir,
      resolved_model_dir: '', resolved_files: [],
      copied_to: ownedCacheRoot, copied_files: 0
    };
    // Copy-phase accounting (D4): the pre-copy re-read/hash, the copy itself and the
    // post-copy re-verify are all real I/O over the whole cache, so they are charged to
    // the bootstrap cost instead of being absorbed. Sizes come from the already-verified
    // source pass, so sizing them costs no extra read.
    const sourceBytes = new Map(cacheCost.resolved_files.map(f => [f.relative, f.bytes]));
    const copyStarted = performance.now();
    let copiedBytes = 0;
    for (const entry of ownedPlacement.files) {
      const src = physical(join(cache.source, entry.relative), cache.source);
      assert.equal(sha(readFileSync(src)), cache.files_sha256[entry.relative], 'cache drift before copy');
      ownedPath(dirname(entry.absolute));
      mkdirSync(dirname(entry.absolute), { recursive: true });
      ownedPath(entry.absolute); copyFileSync(src, entry.absolute);
      const size = sourceBytes.get(entry.relative);
      assert(size !== undefined, `verified source pass has no byte count for ${entry.relative}`);
      // N9: charge BOTH legs of this file's copy phase. The `sha(readFileSync(src))`
      // above reads `size` bytes and `copyFileSync` writes `size` bytes, so adding the
      // size once silently dropped the write leg from `modelCopyBytes`.
      copiedBytes += size * 2;
      modelCache.copied_files += 1;
    }
    cost.modelCopyBytes = copiedBytes;
    cost.modelCopyMs = Math.round((performance.now() - copyStarted) * 1000) / 1000;
    // Post-copy proof at the SDK's RESOLVED paths: the model directory holds exactly
    // the SDK-required entries, and every file the SDK will read exists as a regular,
    // non-symlink, non-empty file whose bytes match the pinned digest.
    const copied = verifyModelCacheOnDisk(ownedCacheRoot, requirement, cache.files_sha256);
    cost.modelReverifyBytes = copied.bytes;
    cost.modelReverifyMs = copied.milliseconds;
    assert.equal(copied.bytes, cacheCost.bytes, 'owned cache copy is not byte-identical to the complete source cache');
    assert.equal(copied.model_dir, ownedPlacement.modelDir,
      'owned cache copy is not at the SDK-resolved model directory');
    modelCache.resolved_model_dir = copied.model_dir;
    modelCache.resolved_files = copied.resolved_files;
    // No inherited endpoint/key, user config, NODE_OPTIONS, or external cache write.
    const path = process.env.PATH ?? '';
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, TASK, {
      PATH: path, HOME: paths['home'], USERPROFILE: paths['home'],
      TMPDIR: paths['tmp'], TMP: paths['tmp'], TEMP: paths['tmp'],
      XDG_CACHE_HOME: paths['cache'], XDG_CONFIG_HOME: paths['config'], XDG_DATA_HOME: paths['data'],
      APPDATA: paths['config'], LOCALAPPDATA: paths['cache'], HF_HOME: paths['cache'],
      HF_HUB_CACHE: paths['cache'], TRANSFORMERS_CACHE: paths['cache'], TORCH_HOME: paths['cache'],
      SQUADRULES_HOME: paths['squadrules'], FASTEMBED_CACHE_DIR: paths['model-cache'],
      FASTEMBED_MODEL: cache.model, EMBEDDING_PROVIDER: 'fastembed', TRANSPORT_TYPE: 'http',
      AUTH_ENABLED: 'false', QDRANT_URL: '', REDIS_URL: '', KEY_VALUE_STORE_URL: '',
      OPENAI_API_KEY: '', TEI_BASE_URL: '', LOG_LEVEL: 'error', SQUADRULES_NO_BROWSER: '1',
      SQUADRULES_GRAPH_BACKEND: 'embedded', SQUADRULES_GRAPH_DB_ENABLED: 'true',
      SQUADRULES_GRAPH_DB_PATH: join(dir, 'graph'),
      SQUADRULES_INHERITANCE_CHECKPOINT_DIR: paths['checkpoints'],
      SQUADRULES_LOCAL_ARTIFACT_DIR: paths['artifacts'], SQUADRULES_ALLOWED_EXPORT_DIRS: paths['artifacts']
    });
    // D3 boundary assertion. The installed SDK does NOT read FASTEMBED_CACHE_DIR: three
    // links connect the env var to the paths it opens — (1) repo config reads the env var
    // (src/config/embedding-fastembed.ts:22), (2) the provider hands that value to the SDK
    // as its `cacheDir` (src/services/embedding/fastembed-provider.ts:32), (3) the SDK then
    // applies its OWN path.join(cacheDir, repo.replace("/", "_")). Re-deriving link 3 from
    // the actual env value therefore checks the whole chain end-to-end: every path the SDK
    // will read must be the verified, resolved, absolute path inside the owned copy.
    const sdkPlacement = sdkCachePlacement(process.env.FASTEMBED_CACHE_DIR!, requirement);
    assert.equal(sdkPlacement.modelDir, modelCache.resolved_model_dir,
      'FASTEMBED_CACHE_DIR must resolve, via the SDK rule, to the verified owned model directory');
    assert.deepEqual(sdkPlacement.files.map(f => f.absolute), modelCache.resolved_files.map(f => f.absolute),
      'every path the SDK will read must be a resolved, verified absolute path, in the SDK read order');
    // Re-assert the SAME binding after the environment switch: the threaded inventory
    // is reused, so this adds no verifier run and no second source traversal.
    independentPacket(bootstrapPath, bootstrapPin, 'bootstrap-delta', sha(DELTA), inventory);
    // First production imports occur ONLY after stdlib byte/scope/source preflight.
    let boot: any; let server: Server | undefined;
    try {
      const runtime = await import('../../src/runtime/boot-local-runtime.js');
      const lance = await import('../../src/services/vector-store/lancedb/LanceVectorRecordStore.js');
      const http = await import('../../src/http/http-server.js');
      const tenant = await import('../../src/utils/tenant-context.js');
      const scope = await import('../../src/services/graph-db/adapter-scope.js');
      const actor = await import('../../src/services/graph-db/graph-actor.js');
      const provider = await import('../../src/services/embedding/provider-resolver.js');
      const dimension = await import('../../src/services/embedding/config.js');
      const frontmatter = await import('../../src/utils/frontmatter.js');
      const resolveSpace = await import('../../src/utils/resolve-space-param.js');
      const owner = await import('../../src/services/graph-db/graph-owner.js');
      const engine = await import('../../src/services/vector-store/lancedb/lance-records-engine.js');
      const schema = await import('../../src/services/vector-store/lancedb/lance-records-schema.js');
      const metadata = await import('../../src/services/vector-store/lancedb/lance-store-metadata.js');
      ownedPath(join(dir, 'records'));
      const records = new lance.LanceVectorRecordStore({ databaseDir: join(dir, 'records') });
      boot = await runtime.bootLocalRuntime({ records, loadEmbeddings: true, seedAdapters: 'never' });
      assert(boot.graphDb?.isInitialized(), 'real graph boot failed, not passing degradation');
      assert.equal(records.getDirectory(), join(dir, 'records'));
      assert.equal(owner.getGraphDb(boot.memoryStore), boot.graphDb);
      assert.equal(owner.getGraphDb(boot.qdrantService), boot.graphDb);
      const descriptor = provider.getSuccessfulProvider();
      assert.equal(descriptor?.provider, 'fastembed');
      assert.equal(descriptor?.model, cache.model);
      assert(descriptor && descriptor.dimension > 0);
      assert.equal(dimension.getResolvedEmbeddingDimension(), descriptor.dimension);
      const context = tenant.getSpaceContext();
      assert(context.personalSpaceId && context.personalSpaceId === context.defaultWriteSpaceId);
      const personal = resolveSpace.resolveSpaceParamForContext(context, 'personal');
      assert(personal.ok); assert.equal(personal.spaceId, context.personalSpaceId);
      const resolvedActor = actor.resolveGraphActor();
      assert.equal(resolvedActor.actor_source, 'runtime-local');
      ownedPath(join(dir, 'http-listener'));
      // Prerequisite A1 — the REAL production listener, explicitly bound to loopback.
      server = http.startHttpServer(0, boot.memoryStore, boot.qdrantService, '127.0.0.1');
      const listener = server;
      await new Promise<void>((resolve, reject) => {
        if (listener.listening) resolve();
        else { listener.once('listening', resolve); listener.once('error', reject); }
      });
      const address = server.address();
      assert(address && typeof address === 'object', 'bound address must be an AddressInfo, not a pipe/string');
      const bound = address as AddressInfo;
      // Assert the ACTUAL bound address, never the requested one: a wildcard bind fails here.
      assert.equal(bound.address, '127.0.0.1', 'listener must be bound to loopback, not a wildcard interface');
      assert.equal(bound.family, 'IPv4', 'loopback bind must be IPv4 127.0.0.1');
      assert(bound.port > 0, 'kernel-assigned port required');
      const baseUrl = `http://${bound.address}:${bound.port}`;
      const binding: LoopbackBinding = {
        host: '127.0.0.1', address: bound.address, family: bound.family,
        port: bound.port, baseUrl, wildcard: false
      };
      const r = new ReviewedRuntime(dir, bootstrapPath, bootstrapPin,
        { tenant, scope, actor, frontmatter, provider, descriptor, engine, schema, metadata }, records, boot, server,
        baseUrl, context, resolvedActor, scope.adapterGraphKey(context.personalSpaceId, SLUG),
        binding, requirements, modelCache, [cost], inventory);
      r.record('boot.json', { task: TASK, dir, baseUrl, context, actor: resolvedActor,
        descriptor, delta: DELTA, evidenceLimit: evidence.captureLimit,
        listener: binding, source_inventory: {
          sha256: inventory.sha256, files_hashed: inventory.files_hashed,
          bytes_hashed: inventory.bytes_hashed, milliseconds: inventory.milliseconds
        },
        bootstrap_packet_requirements: requirements, model_cache: modelCache, preflight_cost: r.costs });
      return r;
    } catch (error) {
      process.stderr.write('Source bootstrap failed: ' + String(error) + '\n');
      try {
        const path = join(dir, 'startup-failure.json'); ownedPath(path);
        writeFileSync(path, JSON.stringify({ error: String(error), stack: error instanceof Error ? error.stack : undefined }) + '\n', { flag: 'wx' });
      } catch (retentionError) { process.stderr.write('Startup-retention blocker: ' + String(retentionError) + '\n'); }
      if (server?.listening) {
        try { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(e => e ? reject(e) : resolve())); }
        catch (closeError) { process.stderr.write('Startup listener close failed: ' + String(closeError) + '\n'); }
      }
      if (boot?.graphDb) {
        try { await boot.graphDb.close(); }
        catch (closeError) { process.stderr.write('Startup graph close failed: ' + String(closeError) + '\n'); }
      }
      // If production boot failed before returning its handles, standalone exit releases
      // native resources. Never reopen/delete its data or hide the original failure.
      throw error;
    }
  }

  record(name: string, observed: unknown): string {
    assert(!name.includes('/'));
    const path = join(this.dir, name);
    // Evidence writes carry ZERO verifier runs and ZERO inventories: the enclosing
    // mutation preflight already paid for both. Only containment is re-proved here.
    ownedPath(path);
    assert(!existsSync(path), 'retain all prior scenario evidence; no overwrite');
    writeFileSync(path, JSON.stringify(observed, null, 2) + '\n', { flag: 'wx' });
    this.writes += 1;
    return path;
  }
  recordBytes(name: string, bytes: string): string {
    assert(!name.includes('/'));
    const path = join(this.dir, name);
    ownedPath(path);
    assert(!existsSync(path), 'retain all prior scenario evidence; no overwrite');
    writeFileSync(path, bytes, { flag: 'wx' });
    this.writes += 1;
    return path;
  }
  async post(name: string, route: string, body: unknown, guard?: () => Promise<unknown>) {
    this.record(name + '.request.json', body);
    if (route === '/api/train' || route === '/api/tune') {
      assert(guard, 'every attempted mutation requires immediate source/evidence/context/state preflight');
      await guard();
    }
    const res = await fetch(this.baseUrl + route, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000)
    });
    const raw = await res.text();
    this.recordBytes(name + '.response.raw.json', raw);
    const reply = { status: res.status, body: JSON.parse(raw) };
    this.record(name + '.response.json', reply);
    return reply;
  }
  /**
   * Packet/runtime identity check. When a `SourceInventory` is supplied for the
   * current preflight it is reused, so this never triggers a second full traversal.
   */
  verifyRuntime(inventory?: SourceInventory): void {
    independentPacket(this.bootstrapPath, this.bootstrapPin, 'bootstrap-delta', sha(DELTA), inventory);
    assert.deepEqual(this.modules.tenant.getSpaceContext(), this.context, 'personal runtime identity drift');
    assert.deepEqual(this.modules.actor.resolveGraphActor(), this.actor, 'runtime actor drift');
    assert.deepEqual(this.modules.provider.getSuccessfulProvider(), this.modules.descriptor, 'real provider drift');
  }
  async observe(supplied?: SourceInventory) {
    let inventory = supplied;
    if (!inventory) {
      // A standalone observation costs one inventory and zero verifier runs, measured.
      const cost = emptyCost('observation');
      inventory = budgetedInventory(cost);
      this.costs.push(cost);
    }
    this.lastInventory = inventory;
    this.verifyRuntime(inventory);
    const ctx = this.modules.tenant.getSpaceContext();
    const records = [];
    for (const id of ctx.allowedSpaceIds) {
      const rows = await this.records.scrollSpace(id, { paginate: true });
      records.push(...rows);
    }
    records.sort((a: any, b: any) => a.uuid.localeCompare(b.uuid));
    const resolved = await this.boot.qdrantService.findFirstStepMemoryUuidBySlug(SLUG);
    const head = resolved.layerUuid ? await this.boot.memoryStore.getMemory(resolved.layerUuid, { fresh: true }) : null;
    const layers = head ? await this.boot.qdrantService.getAdapterLayers(head.adapter.id, [head.space_id]) : [];
    // Read-only production engine, same owned directory and process. Never call its
    // writers, reach private fields, substitute vectors, or open native data elsewhere.
    const reader = new this.modules.engine.LanceRecordEngine(this.records.getDirectory());
    assert.equal(reader.getDirectory(), join(this.dir, 'records'));
    const table = await reader.openTableIfPresent();
    const rowCount = table ? await table.countRows() : 0;
    const rawRows = (await reader.scroll({})).map((row: any) => {
      const plain = { ...row };
      for (const name of Object.keys(plain)) if (/^(?:(?:adapter_title|activation_pattern)_)?vs\d+$/.test(name)) {
        const values = this.modules.schema.toNumberArray(plain[name]);
        assert(values, 'stored dense vector is not a numeric iterable'); plain[name] = values;
      }
      return plain;
    }).sort((a: any, b: any) => a.id.localeCompare(b.id));
    const storedSchema = await reader.inspectStoredSchema();
    const storeMetadata = this.modules.metadata.readStoreMetadata(reader.getDirectory());
    const graph = this.boot.graphDb;
    return {
      context: ctx, key: this.key, resolved, records, layers, head, rowCount, rawRows, storedSchema, storeMetadata,
      adapters: await graph.getAllAdapters(), node: await graph.getAdapter(this.key),
      history: await graph.listVersions(this.key), latest: await graph.getLatestVersion(this.key),
      ancestors: await graph.findPathToRoot(this.key), children: await graph.getChildren(ctx.personalSpaceId, SLUG),
      proposals: await graph.listProposals(), anomalies: await graph.listAnomalies()
    };
  }
  assertState(s: any, content: string | null, version: string | null, count: number): void {
    assert.deepEqual(s.ancestors, []); assert.deepEqual(s.children, []);
    assert.deepEqual(s.proposals, []); assert.deepEqual(s.anomalies, []);
    assert.equal(s.records.length, content === null ? 0 : 1);
    assert.equal(s.rawRows.length, s.rowCount, 'raw scan/count mismatch');
    assert.equal(s.rowCount, s.records.length, 'records hidden outside allowed personal/app scope');
    assert.equal(s.layers.length, content === null ? 0 : 1);
    assert.equal(s.adapters.length, content === null ? 0 : 1);
    assert.equal(s.history.length, count);
    if (content === null) {
      assert.equal(s.head, null); assert.equal(s.node, null); assert.equal(s.latest, null);
      assert.equal(s.storeMetadata, null); assert.deepEqual(s.storedSchema, { status: 'absent' });
      return;
    }
    const parsed = this.modules.frontmatter.parseFrontmatter(content);
    const descriptor = this.modules.descriptor;
    assert.equal(s.storedSchema.status, 'valid');
    assert.equal(s.storedSchema.primaryWidth, descriptor.dimension);
    assert.deepEqual(s.storedSchema.companionWidths, [descriptor.dimension]);
    assert.equal(s.storeMetadata.provider, descriptor.provider);
    assert.equal(s.storeMetadata.model, descriptor.model);
    assert.equal(s.storeMetadata.dimension, descriptor.dimension);
    const row = s.rawRows[0];
    assert.equal(row.id, s.head.memory_uuid);
    assert.equal(row.space_id, this.context.personalSpaceId);
    assert.equal(row.adapter_id, s.head.adapter.id); assert.equal(row.slug, SLUG);
    assert.equal(row.protocol_version, version);
    assert.deepEqual(JSON.parse(row.payload), s.records[0].payload);
    const names = [`vs${descriptor.dimension}`, `adapter_title_vs${descriptor.dimension}`, `activation_pattern_vs${descriptor.dimension}`];
    assert.deepEqual(Object.keys(row).filter(n => /^(?:(?:adapter_title|activation_pattern)_)?vs\d+$/.test(n)).sort(), names.sort());
    for (const name of names) {
      const values = row[name];
      assert.equal(values.length, descriptor.dimension);
      assert(values.every((v: number) => Number.isFinite(v)));
      assert(values.some((v: number) => v !== 0), 'real provider write degraded to zero vectors');
    }
    assert.equal(s.head.space_id, this.context.personalSpaceId);
    assert.equal(s.head.slug, SLUG);
    assert.equal(s.head.adapter.protocol_version, version);
    assert.equal(s.head.adapter.layer_count, 1);
    assert.equal(s.head.adapter.frontmatter.slug, SLUG);
    assert.equal(s.head.adapter.frontmatter.version, version);
    assert.equal(s.head.adapter.frontmatter.inherits, undefined);
    const segment = parsed.body.slice(parsed.body.indexOf('\n') + 1, parsed.body.indexOf('```json')).trim();
    assert.equal(s.head.text, segment, 'stored layer prose differs from reviewed single-layer content');
    assert.equal(s.head.adapter.reward_signal, '## Reward Signal\n\nDone.');
    assert.deepEqual(s.head.adapter.activation_patterns, [SLUG]);
    const contract = JSON.parse(content.match(/```json\n([^]+?)\n```/)![1]!);
    // adapter-builder.ts supplies required=true when absent; request bytes are untouched.
    assert.deepEqual(s.head.inference_contract, { ...contract.contract, required: contract.contract.required ?? true });
    assert.equal(s.layers[0].uuid, s.head.memory_uuid);
    assert.equal(s.node.key, this.modules.scope.adapterGraphKey(s.head.space_id, SLUG));
    assert.equal(s.node.space, s.head.space_id); assert.equal(s.node.version, version);
    assert.equal(s.latest.content, content);
    assert.equal(s.latest.content_digest, sha(content));
    assert.equal(s.latest.version_number, String(count));
    for (const h of s.history) {
      assert.equal(h.content_digest, sha(h.content)); assert.equal(h.space, s.head.space_id);
      assert.equal(h.entity_key, s.node.key);
      const historical = this.modules.frontmatter.parseFrontmatter(h.content);
      assert.equal(h.adapter_version, historical.version);
      assert.equal(h.changed_by, this.actor.actor); assert.equal(h.actor_source, this.actor.actor_source);
    }
  }
  async prewrite(content: string | null, version: string | null, count: number, prior?: any) {
    // AT MOST one isolation verifier pass and one full-source inventory per preflight.
    const cost = emptyCost('mutation-prewrite:' + (version ?? 'none') + ':' + count);
    budgetedVerify(cost);
    initialEvidence();
    const inventory = budgetedInventory(cost);
    this.lastInventory = inventory;
    this.costs.push(cost);
    const observed = await this.observe(inventory);
    this.assertState(observed, content, version, count);
    if (prior) assert.deepEqual(observed, prior, 'state drift immediately before write');
    // Same snapshot: re-assert packet/runtime identity at the end of the preflight
    // without a second verifier run or traversal.
    this.verifyRuntime(inventory);
    return observed;
  }
  async close(): Promise<void> {
    const errors: unknown[] = [];
    try {
      this.server.closeAllConnections();
      await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    } catch (error) { errors.push(error); }
    try { await this.boot.graphDb.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'source runtime cleanup failed');
    // Keep all owned data/logs, including failures. Lance handles end with THIS process.
  }
}

export async function runReviewedHttpContent(): Promise<void> {
  const r = await ReviewedRuntime.start();
  let primary: unknown;
  try {
    const initial = initialEvidence();
    const blank = await r.prewrite(null, null, 0);
    r.record('before-create.json', blank);
    await r.prewrite(null, null, 0, blank);
    const create = await r.post('create', '/api/train', {
      content: initial.seed, llm_model_id: 'it-http-graph', force_update: false,
      space: 'personal', review_evidence: initial.envelope
    }, () => r.prewrite(null, null, 0, blank));
    assert.equal(create.status, 200); assert.equal(create.body.status, 'stored');
    assert.equal(create.body.items.length, 1);
    assert.equal(create.body.items[0].adapter_uri, TARGET);
    const seeded = await r.observe(); r.record('after-create.json', seeded);
    r.assertState(seeded, initial.seed, '1.0.0', 1);
    assert.equal(seeded.history[0].version_number, '1');
    assert.equal(seeded.history[0].parent_version, null);
    assert.equal(seeded.history[0].change_type, 'created');
    assert.equal(create.body.items[0].layer_uuid, seeded.head.memory_uuid);
    await r.prewrite(initial.seed, '1.0.0', 1, seeded);
    const tune = await r.post('tune', '/api/tune', {
      uris: [TARGET], content: [initial.update], expected_version: '1.0.0', review_evidence: initial.envelope
    }, () => r.prewrite(initial.seed, '1.0.0', 1, seeded));
    assert.equal(tune.status, 200);
    assert.equal(tune.body.total_updated, 1); assert.equal(tune.body.total_failed, 0);
    assert.equal(tune.body.results.length, 1); assert.equal(tune.body.results[0].status, 'updated');
    assert.equal(tune.body.results[0].uri, 'squadrules://layer/' + seeded.head.memory_uuid);
    assert.equal(tune.body.results[0].error, undefined);
    const updated = await r.observe(); r.record('after-tune.json', updated);
    r.assertState(updated, initial.update, '1.1.0', 2);
    assert.equal(updated.head.memory_uuid, seeded.head.memory_uuid);
    assert.equal(updated.head.adapter.id, seeded.head.adapter.id);
    assert.deepEqual(updated.head.inference_contract, seeded.head.inference_contract);
    assert.deepEqual(updated.history.find((h: any) => h.version_number === '1'), seeded.history[0]);
    assert.equal(updated.latest.parent_version, '1');
    assert.equal(updated.latest.change_type, 'updated');
    await r.prewrite(initial.update, '1.1.0', 2, updated);
    const stale = await r.post('stale', '/api/tune', {
      uris: [TARGET], content: [initial.stale], expected_version: '9.9.9', review_evidence: initial.envelope
    }, () => r.prewrite(initial.update, '1.1.0', 2, updated));
    assert.equal(stale.status, 200);
    assert.equal(stale.body.total_updated, 0); assert.equal(stale.body.total_failed, 1);
    assert.equal(stale.body.results.length, 1); assert.equal(stale.body.results[0].status, 'error');
    assert.equal(stale.body.results[0].uri, TARGET);
    assert.deepEqual(stale.body.results[0].error, {
      code: 'VERSION_CONFLICT', target: TARGET, expected: '9.9.9', current: '1.1.0'
    });
    const rejected = await r.observe(); r.record('after-stale.json', rejected);
    r.assertState(rejected, initial.update, '1.1.0', 2);
    assert.deepEqual(rejected, updated, 'stale rejection changed head/layers/graph/history/counts');
    // N8: thread the inventory `observe()` just measured. A bare `verifyRuntime()`
    // would fall back to `sourceHashes()` and pay a second 445-file traversal that no
    // counter and no disclosed limitation accounted for.
    r.verifyRuntime(r.inventory);
    const historical = await r.post('historical-export', '/api/export', {
      uri: TARGET, version: '1', format: 'markdown', include_reward: false
    });
    assert.equal(historical.status, 200);
    assert.equal(historical.body.uri, TARGET); assert.equal(historical.body.format, 'markdown');
    assert.equal(historical.body.content_type, 'text/markdown'); assert.equal(historical.body.item_count, 1);
    assert.equal(historical.body.content, initial.seed);
    assert.equal(historical.body.snapshot_sha256, sha(initial.seed));
    assert.equal(historical.body.history_version, '1'); assert.equal(historical.body.adapter_version, '1.0.0');
    assert.equal(historical.body.space_id, rejected.head.space_id);
    assert.equal(historical.body.snapshot_changed_by, seeded.history[0].changed_by);
    assert.equal(historical.body.snapshot_changed_at, seeded.history[0].changed_at);
    assert.equal(historical.body.history_versions, 2);
    r.recordBytes('historical-observed.md', historical.body.content);
    // Same snapshot: the export is read-only, so reusing `r.inventory` is still the
    // source state this preflight measured — and costs no extra traversal.
    r.verifyRuntime(r.inventory);
    const current = await r.post('current-export', '/api/export', {
      uri: TARGET, format: 'markdown', include_reward: false
    });
    assert.equal(current.status, 200); assert.equal(typeof current.body.content, 'string');
    // Current export is reconstructed. Check actual stored prose/contract, NOT seed byte equality.
    assert.equal(current.body.uri, TARGET); assert.equal(current.body.format, 'markdown');
    assert.equal(current.body.content_type, 'text/markdown'); assert.equal(current.body.item_count, 1);
    assert.equal(current.body.space_id, rejected.head.space_id);
    assert.equal(current.body.adapter_version, rejected.head.adapter.protocol_version);
    assert.equal(current.body.adapter_name, rejected.head.adapter.name);
    const currentParsed = r.modules.frontmatter.parseFrontmatter(current.body.content);
    assert.equal(currentParsed.slugRaw, rejected.head.slug);
    assert.equal(currentParsed.version, rejected.head.adapter.protocol_version);
    const currentProse = currentParsed.body.slice(currentParsed.body.indexOf('\n') + 1, currentParsed.body.indexOf('```json')).trim();
    assert.equal(currentProse, rejected.head.text);
    assert(current.body.content.trimEnd().endsWith(rejected.head.adapter.reward_signal));
    const exportedContract = JSON.parse(current.body.content.match(/```json\n([^]+?)\n```/)![1]!);
    assert.deepEqual(exportedContract.contract, rejected.head.inference_contract);
    r.recordBytes('current-reconstructed-observed.md', current.body.content);
    const beforeRestore = await r.observe(); assert.deepEqual(beforeRestore, rejected);
    const restoreBody = {
      content: historical.body.content, llm_model_id: 'it-http-graph', force_update: true,
      space: 'personal', expected_version: '1.1.0'
    };
    const waitStarted = performance.now();
    const waitRemaining = () => 600_000 - (performance.now() - waitStarted);
    // One verifier pass and one inventory for the whole handoff; the packet checks
    // written into this phase reuse that single snapshot.
    const handoffCost = emptyCost('phase-restore-handoff');
    budgetedVerify(handoffCost);
    const handoffInventory = budgetedInventory(handoffCost);
    r.costs.push(handoffCost);
    const handoff = {
      phase: 'WAITING_SEPARATE_RUNTIME_BOUND_RESTORE_JUDGMENT', task: TASK,
      runtime: { dir: r.dir, baseUrl: r.baseUrl, context: r.context, actor: r.actor, key: r.key,
        listener: r.listener },
      source_sha256: handoffInventory.files, bootstrap_sha256: r.bootstrapPin,
      source_inventory: { sha256: handoffInventory.sha256, files_hashed: handoffInventory.files_hashed,
        bytes_hashed: handoffInventory.bytes_hashed, milliseconds: handoffInventory.milliseconds },
      listener: r.listener, model_cache: r.modelCache,
      bootstrap_packet_requirements: r.requirements,
      initialEvidenceLimit: initial.captureLimit, reviewerRoleLimit: initial.roleLimit,
      historical, current, state: beforeRestore, restore_request_without_evidence: restoreBody,
      restore_request_sha256: sha(JSON.stringify(restoreBody)),
      decision_file: join(r.dir, 'restore.supplied-evidence.json'),
      deadline: new Date(Date.now() + 600_000).toISOString(),
      requirements: 'Independent coordinator/reviewer reads actual bytes/current state and exact request; retain actual return, verdict, syntax stdout/stderr and actual reader capture with limitations. No initial verdict reuse. Reply packet purpose=restore; binding=sha256(this phase file); reviewed_request_sha256=this request digest; same task/source inventory. No author-written verdicts or evidence.'
    };
    const phasePath = r.record('phase-restore-wait.json', handoff);
    const phaseHash = sha(readFileSync(phasePath));
    console.log(JSON.stringify({ phaseFile: phasePath, sha256: phaseHash, decisionFile: handoff.decision_file, deadline: handoff.deadline }));
    let packet: any; let decisionInventory: SourceInventory | undefined;
    while (waitRemaining() > 0) {
      if (existsSync(handoff.decision_file)) {
        // Coordinator atomically publishes packet last; its separate sha256 file is the observed handoff pin.
        const pinFile = handoff.decision_file + '.sha256';
        assert(existsSync(pinFile), 'restore packet arrived without separately retained capture pin');
        physical(pinFile, r.dir);
        const pin = readFileSync(pinFile, 'utf8').trim();
        // The wait may have been long, so the decision gets its OWN fresh snapshot:
        // one verifier run and one inventory, then threaded through both packets.
        const cost = emptyCost('restore-decision');
        budgetedVerify(cost);
        decisionInventory = budgetedInventory(cost);
        r.costs.push(cost);
        packet = independentPacket(handoff.decision_file, pin, 'restore', phaseHash, decisionInventory);
        assert.equal(packet.reviewed_request_sha256, handoff.restore_request_sha256);
        const bootstrap = independentPacket(r.bootstrapPath, r.bootstrapPin, 'bootstrap-delta', sha(DELTA), decisionInventory);
        assert.notEqual(packet.verdict_sha256, bootstrap.verdict_sha256, 'restore requires a distinct runtime-bound judgment');
        // The phase the reviewer bound must still be byte-identical right now.
        checkHash(phasePath, phaseHash);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(1, waitRemaining()))));
    }
    assert(packet && decisionInventory && waitRemaining() > 0, 'BLOCKED: bounded 10-minute restore review wait expired; restore NOT executed');
    checkHash(phasePath, phaseHash);
    await r.prewrite(initial.update, '1.1.0', 2, beforeRestore);
    // Re-read the separate packet immediately before write; no replacement/retry of a stale request.
    const pinned = readFileSync(handoff.decision_file + '.sha256', 'utf8').trim();
    const refreshed = independentPacket(handoff.decision_file, pinned, 'restore', phaseHash, r.inventory);
    assert.deepEqual(refreshed, packet);
    const restored = await r.post('restore', '/api/train', { ...restoreBody, review_evidence: packet.review_evidence }, async () => {
      checkHash(phasePath, phaseHash);
      const state = await r.prewrite(initial.update, '1.1.0', 2, beforeRestore);
      const latest = independentPacket(handoff.decision_file, pinned, 'restore', phaseHash, r.inventory);
      assert.deepEqual(latest, packet);
      assert(waitRemaining() > 0, 'BLOCKED: restore approval/preflight exceeded bounded wait; no restore');
      return state;
    });
    assert.equal(restored.status, 200); assert.equal(restored.body.status, 'stored');
    assert.equal(restored.body.items.length, 1); assert.equal(restored.body.items[0].adapter_uri, TARGET);
    const final = await r.observe(); r.record('after-restore.json', final);
    r.assertState(final, historical.body.content, '1.0.0', 3);
    assert.equal(final.head.adapter.id, seeded.head.adapter.id, 'ordinary restore must retain adapter identity');
    assert.equal(restored.body.items[0].layer_uuid, final.head.memory_uuid);
    assert.notEqual(final.head.memory_uuid, beforeRestore.head.memory_uuid, 'force-update train mints new layer UUIDs');
    assert.equal(await r.boot.memoryStore.getMemory(beforeRestore.head.memory_uuid, { fresh: true }), null);
    assert.equal(final.latest.parent_version, '2');
    assert.equal(final.latest.change_type, 'restored');
    assert.match(final.latest.reason, /restored from snapshot 1/);
    for (const old of beforeRestore.history) assert.deepEqual(final.history.find((h: any) => h.key === old.key), old);
    r.record('completed.json', { create: 'asserted', tune: 'asserted', stale: 'asserted', exports: 'asserted', restore: 'asserted',
      loopback: r.listener, evidence_writes: r.writeCount,
      preflight_cost_design: 'one isolation verifier pass + at most one full-source inventory per preflight; evidence writes cost zero of either; every verifyRuntime() call reuses the threaded inventory, so no packet check re-walks src/; the bootstrap also charges all three cache byte passes and both legs of the copy with their own durations (modelCacheBytes/modelCacheMs = declared source, modelCopyBytes/modelCopyMs = pre-copy re-hash read plus copyFileSync write, both legs charged, modelReverifyBytes/modelReverifyMs = post-copy re-verify); KNOWN LIMITATION: filesHashed/bytesHashed still measure only the source inventory, so initialEvidence() pin/verdict/capture re-reads, independentPacket() artifact/verdict re-reads and the 23 KB SDK text read remain uncounted and the totals understate real I/O',
      preflight_cost: r.costs });
    console.log('HTTP_REVIEWED_SOURCE_SCENARIO_COMPLETE');
  } catch (error) {
    primary = error;
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
    try { r.record('failure.json', { error: String(error), stack: error instanceof Error ? error.stack : undefined }); }
    catch (retentionError) { process.stderr.write('Failure-retention blocker: ' + String(retentionError) + '\n'); }
    throw error;
  } finally {
    try { await r.close(); }
    catch (error) { if (!primary) throw error; process.stderr.write('Close failure: ' + String(error) + '\n'); }
  }
}

// Plain-Node source entry for http-api-graph-reviewed-content.test.ts.
// Neither branch calls `process.exit()` on the ordinary completion path.
// Historical real-provider probes with a live onnxruntime-node InferenceSession
// (fastembed) showed force-exit native teardown throwing a mutex-related
// std::system_error and aborting the process (SIGABRT, exit 134). On
// the success path that abort lands AFTER the scenario's success marker; on the
// failure path it replaces the clean non-zero status the supervisor needs. Both
// fail the lane. Setting `process.exitCode` reports the same status and lets
// teardown run through the ordinary path. `r.close()` was attempted in the
// `finally` above; cleanup failures are retained, so successful closure is not
// assumed. The loop can drain when no referenced handles remain.
// The failure branch keeps one bounded last resort, the same shape as
// src/index.ts: an UNREF'd timer armed ONLY once the scenario promise has
// REJECTED. It force-exits if a still-referenced handle (a leaked listener or
// a foreign handle) keeps the loop alive after that rejection, so such a handle
// cannot hang the supervisor for its full 20-minute budget. It does NOT bound a
// cleanup that never settles: a pending close keeps the promise unresolved, so
// the rejection handler that arms the timer never runs. Being unref'd, it never
// fires on a process that drains normally.
if (process.argv[1]?.endsWith('/http-reviewed-runtime.ts')) {
  runReviewedHttpContent().then(() => { process.exitCode = 0; }, error => {
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
    process.exitCode = 1;
    setTimeout(() => {
      process.stderr.write('Scenario failed but a handle kept the event loop alive; force-exiting after the 2s grace period\n');
      process.exit(1);
    }, 2000).unref();
  });
}
