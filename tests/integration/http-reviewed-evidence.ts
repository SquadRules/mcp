/*
 * TASK-BOUND PROOF HARNESS — NOT a portable CI lane.
 *
 * Paths below are hard-coded absolute paths of one task worktree and its one
 * task worktree root. Nothing here discovers a checkout, resolves a relative
 * root, or tolerates a different machine: the pins, the isolation verifier call
 * and the model-cache layout are all bound to that single verified worktree. A
 * portable lane would have to substitute every constant and re-review the pins.
 *
 * Standard-library-only preflight. No production, model, native or Jest imports.
 * The only process it may start is the repository's own isolation verifier.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

export const WT = '/Users/jakub.plichcinski/projects/github.com:squadrules:mcp.worktrees/sr6-graph-db-touchpoints';
export const TASK = {
  WT, REPO_ROOT: '/Users/jakub.plichcinski/projects/github.com:squadrules:mcp',
  TASK_ID: 'sr6-graph-db-touchpoints', TASK_BRANCH: 'sr6-graph-db-touchpoints',
  TASK_BASE_SHA: 'a46f2d441743cf73e09229ec67704c160daf9fdf',
  observed_HEAD: 'f3ab197671057bd6f7e2a9cd8344aa6b67404ccb'
};
export const TARGET = 'squadrules://adapter/http-reviewed-cas-adapter';
export const SLUG = 'http-reviewed-cas-adapter';
export const OWNED = [
  'tests/integration/http-api-graph-reviewed-content.test.ts',
  'tests/integration/http-reviewed-evidence.ts',
  'tests/integration/http-reviewed-runtime.ts'
];
export const DELTA = 'Plain-Node ts-node source execution; production bootLocalRuntime with explicit caller-owned Lance records, loadEmbeddings=true, seedAdapters=never, and production startHttpServer(0, memoryStore, qdrantService, "127.0.0.1") whose bound address is asserted to be loopback (server.address().address === "127.0.0.1", IPv4) before the URL is recorded — no monkey-patched listener, no wildcard bind, no stubbed listen; real cached fastembed copied read-only into fresh WT/.local cache only after a stdlib-only fail-closed completeness preflight proves the complete supported-model file set exists at the exact SDK-derived <cacheDir>/<repo_with_underscore>/ layout with recorded sha256 per file (no download, no model probe, no descriptor/vector substitute, no width setter), and that owned copy is re-asserted at the SDK-native path.join(FASTEMBED_CACHE_DIR, repo.replace("/", "_")) so every path the SDK will read is proven to exist as a regular non-symlink file with the pinned digest and non-zero size, with the resolved absolute paths recorded in bootstrap evidence; read-only LanceRecordEngine over that same owned records directory for actual row counts/schema/vectors, using production toNumberArray and readStoreMetadata; optional dedicated Jest supervisor with no existing setup hooks and a whitelisted child environment; no graph-db-fixture, TEI failure priming, bundled seed, fork, storage-write bypass, dist, ancestry, descendants or proposals; actual auth-disabled personal context and runtime-local actor.';
export const AUXILIARY = ['.local/http-reviewed-jest.config.mjs', '.local/http-reviewed-author-check.mjs'];
/** Installed fastembed ESM entry that is the authority for the cache layout. */
export const SDK_FASTEMBED = 'node_modules/fastembed/lib/esm/fastembed.js';
/** Pinned digest of that entry; any change invalidates the derived cache rule. */
export const SDK_FASTEMBED_SHA256 = '29ee847f9e64d31742c7298629741e708fade874b210b275202a18f9e3a5cda2';
const PREP = join(WT, '.local/team-review-preparation');
const SUPPLIED = join(PREP, 'pending-independent-review/refreshed-http-content.supplied-evidence.json');
const SUPPLIED_SHA = '3fab5810781f260b1c1190d2cd70fbb8a702ef083d6ca654863ec153000f0cc0';
const VERDICT_SHA = '2be98502a1bb72af02e373e877e1f4c486148004b3df5c05a643f8ad1d2733fd';
export const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const json = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Model-cache completeness (independent-review prerequisite A2).
 *
 * A non-empty, internally consistent hash inventory proves nothing about a
 * *complete* supported-model cache: the installed SDK treats "the file exists"
 * as "the file is complete". `retrieveModel` walks
 * `[modelFile, ...additionalFiles, ...TOKENIZER_FILES]` and
 * `downloadFileFromHF` returns early for a path that already exists
 * (node_modules/fastembed/lib/esm/fastembed.js:228-235 and :191-199), while
 * `init` resolves `modelDir = <cacheDir>/<repo with "/" -> "_">` and then
 * requires `<modelDir>/<modelFile>`, `tokenizer.json`, `config.json`,
 * `tokenizer_config.json` and `special_tokens_map.json` (:123-146, :147-166).
 * A truncated or partial file therefore passes the SDK's own presence check and
 * is either re-downloaded at runtime (network, not cached-only) or fails mid-boot.
 *
 * The rule implemented here fails closed unless the recorded inventory is exactly
 * the SDK-required file set at the exact SDK-derived directory, every digest is a
 * real sha256 of the real bytes, every entry is a regular non-empty file, and the
 * installed SDK text still contains the constants the rule was derived from.
 * Nothing is downloaded, initialised, probed, or substituted.
 */
interface SdkModelRule {
  /** fastembed `EmbeddingModel` enum value. */
  readonly model: string;
  /** `MODEL_SOURCES[...].repo` — the HuggingFace repo the cache dir is named after. */
  readonly repo: string;
  /** `MODEL_SOURCES[...].modelFile` — the ONNX weights file `init` requires. */
  readonly modelFile: string;
  /** `MODEL_SOURCES[...].additionalFiles` — external weights; empty for bge-small. */
  readonly additionalFiles: readonly string[];
}

/**
 * Pinned per-model expectations. Each one is re-derived from the installed SDK
 * text on every call, so a fastembed upgrade cannot silently change the layout
 * the preflight certifies.
 */
const SDK_MODEL_RULES: { readonly [model: string]: Omit<SdkModelRule, 'model'> } = {
  'fast-bge-small-en-v1.5': {
    repo: 'Qdrant/bge-small-en-v1.5-onnx-Q',
    modelFile: 'model_optimized.onnx',
    additionalFiles: []
  }
};

/** The four tokenizer/config files the SDK requires for every dense model. */
const SDK_TOKENIZER_FILES = ['tokenizer.json', 'tokenizer_config.json', 'config.json', 'special_tokens_map.json'];

/**
 * Verbatim `retrieveModel` line that fixes the ONE directory the SDK reads.
 * The SDK never reads the `cacheDir` root itself for files, so a cache laid out
 * flat at the root is invisible to it (and would be re-downloaded at boot).
 */
const SDK_DIRECTORY_RULE = 'const modelDir = path.join(cacheDir.toString(), repo.replace("/", "_"));';

/** What a complete cache for one model must contain, derived from the SDK. */
export interface ModelCacheRequirement {
  model: string;
  /** fastembed `cacheDir` root (absolute). */
  source: string;
  /** `<repo with "/" -> "_">` — the one directory the SDK will look in. */
  modelDirectory: string;
  /** Cache-root-relative keys; exactly what `model_cache.files_sha256` must cover. */
  files: string[];
  /** SDK evidence the rule was derived from and re-checked against. */
  sdk: {
    file: string; sha256: string; repo: string; model_file: string; additional_files: string[];
    tokenizer_files: string[]; directory_rule: string;
  };
}

/**
 * Re-derive one model's required cache layout from the installed SDK text.
 * Reads and hashes a 23 KB source file only — never imports fastembed.
 */
export function sdkModelRule(model: string): Omit<ModelCacheRequirement, 'source'> {
  assert.equal(typeof model, 'string');
  const rule = SDK_MODEL_RULES[model];
  assert(rule, `unsupported fastembed model for a cached-only run: ${model}`);
  const sdkPath = physical(join(WT, SDK_FASTEMBED));
  const bytes = readFileSync(sdkPath);
  assert.equal(sha(bytes), SDK_FASTEMBED_SHA256, 'installed fastembed SDK drift invalidates the pinned cache rule');
  const text = bytes.toString('utf8');

  // 1. The SDK's own required-file list, cross-checked against the pin.
  const listBlock = /const TOKENIZER_FILES = \[([\s\S]*?)\];/.exec(text);
  assert(listBlock, 'fastembed TOKENIZER_FILES declaration not found');
  const tokenizerFiles = [...listBlock[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  assert.deepEqual(tokenizerFiles, SDK_TOKENIZER_FILES, 'fastembed TOKENIZER_FILES changed; re-review the cache rule');

  // 2. The cache directory the SDK resolves for this repo.
  assert(
    text.includes(SDK_DIRECTORY_RULE),
    'fastembed cache-directory derivation changed; re-review the cache rule'
  );

  // 3. This repo's MODEL_SOURCES entry: weights file plus external weight parts.
  const repoIndex = text.indexOf(`repo: "${rule.repo}"`);
  assert(repoIndex >= 0, `fastembed MODEL_SOURCES has no ${rule.repo}`);
  const block = text.slice(text.lastIndexOf('{', repoIndex), text.indexOf('}', repoIndex) + 1);
  assert.equal(/modelFile: "([^"]+)"/.exec(block)?.[1], rule.modelFile, 'fastembed modelFile differs from the pinned rule');
  const additionalFiles = [...block.matchAll(/additionalFiles: \[([^\]]*)\]/g)].flatMap((m) =>
    [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)
  );
  assert.deepEqual(additionalFiles, [...rule.additionalFiles], 'fastembed additionalFiles differ from the pinned rule');

  // 4. `init` fails when the weights file is missing; presence is the ONLY test.
  assert(text.includes('if (!fs.existsSync(modelPath)) {'), 'fastembed model-existence check changed');

  const modelDirectory = rule.repo.replace('/', '_');
  const files = [rule.modelFile, ...rule.additionalFiles, ...tokenizerFiles].sort();
  return {
    model,
    modelDirectory,
    files: files.map((f) => modelDirectory + '/' + f),
    sdk: {
      file: SDK_FASTEMBED,
      sha256: SDK_FASTEMBED_SHA256,
      repo: rule.repo,
      model_file: rule.modelFile,
      additional_files: [...rule.additionalFiles],
      tokenizer_files: tokenizerFiles,
      directory_rule: SDK_DIRECTORY_RULE
    }
  };
}

/** Derive the requirement for a packet-declared cache root, without touching disk contents. */
export function modelCacheRequirement(model: unknown, source: unknown): ModelCacheRequirement {
  assert.equal(typeof source, 'string', 'model_cache.source must be a string');
  assert(isAbsolute(source as string), 'model_cache.source must be the absolute fastembed cacheDir');
  const derived = sdkModelRule(model as string);
  return { ...derived, source: source as string };
}

/**
 * Validate the packet's *declaration*: an inventory that covers exactly the
 * SDK-required file set. Cheap (no 66 MB read); disk bytes are checked separately.
 */
export function assertCompleteModelCache(cache: any): ModelCacheRequirement {
  assert(cache && typeof cache === 'object', 'bootstrap packet requires model_cache{model,source,files_sha256}');
  const requirement = modelCacheRequirement(cache.model, cache.source);
  assert(cache.files_sha256 && typeof cache.files_sha256 === 'object' && !Array.isArray(cache.files_sha256),
    'model_cache.files_sha256 must be a {relative path: sha256} object');
  assert.deepEqual(Object.keys(cache.files_sha256).sort(), requirement.files.slice().sort(),
    'model_cache.files_sha256 must cover exactly the SDK-required files in the exact ' +
    `<cacheDir>/${requirement.modelDirectory}/ layout (missing or extra entries are not a complete cache)`);
  for (const [rel, digest] of Object.entries(cache.files_sha256)) {
    assert.match(String(digest), /^[0-9a-f]{64}$/, `model_cache digest is not sha256: ${rel}`);
  }
  if (cache.model_directory !== undefined) {
    assert.equal(cache.model_directory, requirement.modelDirectory, 'declared model directory is not the SDK layout');
  }
  return requirement;
}

/**
 * The exact paths the installed SDK will read, derived from the SDK rule alone.
 *
 * `retrieveModel` (:228-235) resolves `path.join(cacheDir.toString(),
 * repo.replace("/", "_"))` and then reads `[modelFile, ...additionalFiles,
 * ...TOKENIZER_FILES]` inside it. The cacheDir ROOT is never read for files, so
 * the root and the model directory are NOT interchangeable: a cache copied flat
 * into the root is invisible to the SDK and would be re-downloaded at boot. This
 * helper is the single authority for "which absolute paths must exist", and it is
 * used for BOTH the coordinator-declared source root and the owned copy the
 * runtime points FASTEMBED_CACHE_DIR at.
 */
export interface SdkCachePlacement {
  cacheDir: string;
  modelDirectory: string;
  /** The ONE directory the SDK reads (`<cacheDir>/<repo with "/" -> "_">`). */
  modelDir: string;
  /** Exactly the files the SDK reads, in the SDK's own read order (not sorted). */
  files: { relative: string; absolute: string }[];
}

export function sdkCachePlacement(cacheDir: string, requirement: ModelCacheRequirement): SdkCachePlacement {
  assert.equal(typeof cacheDir, 'string', 'fastembed cacheDir must be a string');
  assert(isAbsolute(cacheDir), `fastembed cacheDir must be the absolute cache root, not a relative path: ${cacheDir}`);
  const order = [
    requirement.sdk.model_file, ...requirement.sdk.additional_files, ...requirement.sdk.tokenizer_files
  ];
  const modelDir = join(cacheDir, requirement.modelDirectory);
  const files = order.map((name) => ({
    relative: requirement.modelDirectory + '/' + name,
    absolute: join(modelDir, name)
  }));
  assert.deepEqual(files.map((f) => f.relative).slice().sort(), requirement.files.slice().sort(),
    'SDK read order and the required file set disagree; re-review the cache rule');
  assert.equal(relative(cacheDir, modelDir), requirement.modelDirectory,
    'the SDK model directory must be exactly one level under the cache root');
  return { cacheDir, modelDirectory: requirement.modelDirectory, modelDir, files };
}

/**
 * Prove the cache AT THE SDK'S OWN RESOLVED PATHS, exactly as `retrieveModel`
 * resolves them, and measure the cost. Requires the model directory to hold
 * exactly the SDK-required entries and every file the SDK will read to be a
 * regular, non-symlink, non-empty file whose real bytes match the pinned digest.
 * Returns the resolved absolute paths so the coordinator can fill
 * `model_cache.source` with the correct root instead of guessing it.
 */
export function verifyModelCacheOnDisk(
  cacheDir: string, requirement: ModelCacheRequirement, expected: Record<string, string>
) {
  const started = performance.now();
  let bytesRead = 0;
  const placement = sdkCachePlacement(cacheDir, requirement);
  const modelDirPath = physical(placement.modelDir, cacheDir);
  const dirStat = lstatSync(modelDirPath);
  assert(dirStat.isDirectory(), `SDK model directory is not a directory: ${placement.modelDir}`);
  assert(!dirStat.isSymbolicLink(), `SDK model directory is a symlink: ${placement.modelDir}`);
  const expectedNames = placement.files
    .map((f) => f.relative.slice(requirement.modelDirectory.length + 1)).sort();
  assert.deepEqual(readdirSync(modelDirPath).sort(), expectedNames,
    'SDK model directory must contain exactly the SDK-required entries (no missing/extra/partial files)');
  const observed: Record<string, string> = {};
  const resolved: { relative: string; absolute: string; bytes: number; sha256: string }[] = [];
  for (const entry of placement.files) {
    const path = physical(entry.absolute, cacheDir);
    const stat = lstatSync(path);
    assert(stat.isFile(), `model cache entry is not a regular file: ${entry.relative}`);
    assert(!stat.isSymbolicLink(), `model cache entry is a symlink: ${entry.relative}`);
    assert(stat.size > 0, `model cache entry is empty (partial download?): ${entry.relative}`);
    const bytes = readFileSync(path);
    assert.equal(bytes.byteLength, stat.size, `model cache entry changed while being read: ${entry.relative}`);
    bytesRead += bytes.byteLength;
    observed[entry.relative] = sha(bytes);
    assert.equal(observed[entry.relative], expected[entry.relative], `model cache bytes drift: ${entry.relative}`);
    resolved.push({
      relative: entry.relative, absolute: path, bytes: bytes.byteLength, sha256: observed[entry.relative]!
    });
  }
  assert.deepEqual(Object.keys(observed).sort(), requirement.files.slice().sort(),
    'resolved cache file set is not the required set');
  return {
    files_sha256: observed,
    files: resolved.length,
    bytes: bytesRead,
    milliseconds: Math.round((performance.now() - started) * 1000) / 1000,
    cacheDir: placement.cacheDir,
    model_directory: placement.modelDirectory,
    model_dir: placement.modelDir,
    resolved_files: resolved
  };
}

/**
 * The limitation statements a bootstrap packet MUST carry (independent-review
 * gap P2). `capture_limit` and `reviewer_separation.limitation` were previously
 * only length-checked, so the mandatory disclosures were a coordinator
 * obligation rather than an enforced field: a packet could drop them and still
 * pass. These phrase sets are the single source of truth — exported in
 * `bootstrapPacketRequirements()` for the coordinator AND enforced by
 * `assertBootstrapLimitations()`, so the published requirement and the check
 * cannot drift. Matching is normalised (lowercase, every run of non-alphanumeric
 * characters collapsed to one space), so hyphenation and wrapping are free but
 * the substance is not.
 */
export const BOOTSTRAP_CAPTURE_LIMIT_PHRASES = [
  'selected fields of the actual',
  'not a complete raw host return capture',
  'an original execution reconstruction',
  'an authenticated delegation receipt'
] as const;
export const BOOTSTRAP_REVIEWER_LIMITATION_PHRASES = [
  'assigned reviewer separation is recorded',
  'no host authenticated delegation identity',
  'content bound provenance'
] as const;
/** Statements the packet must ALSO record in prose; published, not pattern-enforced. */
export const BOOTSTRAP_ALSO_RECORD = [
  // N7: this used to assert what a particular reviewer had or had not done, which a
  // reviewer who DOES read the cache makes false. State the RULE's limits instead:
  // what satisfying the rule can and cannot establish, which stays true either way.
  'the model-cache claim is a fail-closed RULE re-derived from the installed SDK on every check: ' +
    'it establishes that the pinned file set is present, regular and byte-identical at the ' +
    'SDK-resolved path, and it does not establish that any particular reviewer inspected the ' +
    'cache contents',
  'loopback containment is interface containment only, under AUTH_ENABLED=false',
  'the bootstrap verdict is the superseding bootstrap verdict, not the refreshed content verdict'
] as const;

const normalise = (text: unknown): string => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function assertPhrases(field: string, value: unknown, phrases: readonly string[]): void {
  assert.equal(typeof value, 'string', `bootstrap packet ${field} must be a string, not ${typeof value}`);
  assert(String(value).length > 0, `bootstrap packet ${field} must not be empty`);
  const normalised = normalise(value);
  const missing = phrases.filter((phrase) => !normalised.includes(phrase));
  assert.deepEqual(missing, [],
    `bootstrap packet ${field} drops a mandatory limitation (missing: ${missing.map((m) => `"${m}"`).join(', ')}). ` +
    `Carry all of: ${phrases.map((p) => `"${p}"`).join(', ')}`);
}

/** Fail closed unless a bootstrap packet carries BOTH mandatory limitations. */
export function assertBootstrapLimitations(packet: any): void {
  assert(packet && typeof packet === 'object', 'bootstrap packet must be an object');
  assert.equal(packet.reviewer_separation?.producer, false,
    'bootstrap packet reviewer_separation.producer must be false');
  assertPhrases('capture_limit', packet.capture_limit, BOOTSTRAP_CAPTURE_LIMIT_PHRASES);
  assertPhrases('reviewer_separation.limitation', packet.reviewer_separation?.limitation,
    BOOTSTRAP_REVIEWER_LIMITATION_PHRASES);
}

/**
 * The bootstrap-packet requirement this harness now enforces, as machine-readable
 * evidence for the coordinator that has to author the packet.
 */
export function bootstrapPacketRequirements(
  cache: any, requirement: ModelCacheRequirement = assertCompleteModelCache(cache)
) {
  const placement = sdkCachePlacement(requirement.source, requirement);
  return {
    purpose: 'bootstrap-delta',
    binding_sha256: sha(DELTA),
    // The field SET `independentPacket()` requires for this purpose — a set, not an
    // assertion order. `model_cache` is listed last here while its check
    // (`assertCompleteModelCache`) runs early, right after `implementation_review_approved`
    // and `delta`, so do not read this array as the order the assertions execute in.
    // 'delta' is listed because `p.delta === DELTA` is enforced: a packet authored
    // literally from this machine-readable list must not fail its first bootstrap
    // assertion.
    required_fields: [
      'purpose', 'binding', 'target_uri', 'implementation_review_approved', 'delta', 'task',
      'source_sha256', 'reviewer_separation', 'capture_limit', 'artifacts_sha256', 'review_evidence',
      'verdict_sha256', 'reader', 'syntax_gate', 'returned_report_file', 'model_cache'
    ],
    limitations: {
      enforced: true,
      capture_limit_must_contain: [...BOOTSTRAP_CAPTURE_LIMIT_PHRASES],
      reviewer_separation_limitation_must_contain: [...BOOTSTRAP_REVIEWER_LIMITATION_PHRASES],
      matching_rule: 'case-insensitive; every run of non-alphanumeric characters matches one space',
      also_record: [...BOOTSTRAP_ALSO_RECORD]
    },
    model_cache: {
      semantics:
        'model_cache.source is the absolute fastembed cacheDir ROOT — the value the production provider ' +
        'passes as FlagEmbedding.init({cacheDir}). It is NOT the model directory: the installed SDK ' +
        'resolves its model directory itself and never reads the root for files, so a cache copied flat ' +
        'into the root is invisible to it. model_cache.files_sha256 keys are therefore cache-root-relative ' +
        'and must be exactly required_files, each the sha256 of the real bytes. Nothing is downloaded, ' +
        'probed or substituted; an incomplete or extra-entry cache fails closed.',
      model: requirement.model,
      source: requirement.source,
      model_directory: requirement.modelDirectory,
      sdk_directory_rule: requirement.sdk.directory_rule,
      sdk_reads_only: placement.modelDir,
      required_files: requirement.files,
      required_file_absolute_paths: placement.files.map((f) => f.absolute),
      sdk: requirement.sdk
    }
  };
}

export function physical(path: string, root = WT): string {
  assert(isAbsolute(path), `absolute path required: ${path}`);
  const rel = relative(root, path);
  assert(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel), `outside owned root: ${path}`);
  let p = root;
  assert.equal(realpathSync(root), root);
  for (const part of rel.split('/').filter(Boolean)) {
    p = join(p, part);
    if (existsSync(p)) assert(!lstatSync(p).isSymbolicLink(), `symlink rejected: ${p}`);
    else {
      // lstat catches dangling symlinks too.
      try { lstatSync(p); assert.fail(`occupied missing path: ${p}`); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return path;
}
export function verifyTask(): void {
  assert.equal(realpathSync(process.cwd()), WT);
  for (const [k, v] of Object.entries(TASK)) {
    if (k !== 'observed_HEAD') assert.equal(process.env[k], v, `task environment drift: ${k}`);
  }
  execFileSync('python3', [join(TASK.REPO_ROOT, 'scripts/agent-task-isolation.py'), 'verify'], {
    cwd: WT, env: { ...process.env, ...TASK }, stdio: 'inherit'
  });
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: WT, encoding: 'utf8' }).trim(), TASK.observed_HEAD);
}
export function checkHash(path: string, digest: string): void {
  physical(path);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(sha(readFileSync(path)), digest, `byte drift: ${path}`);
}
export function initialEvidence() {
  physical(SUPPLIED);
  checkHash(SUPPLIED, SUPPLIED_SHA);
  const e = json(SUPPLIED);
  for (const [k, v] of Object.entries(TASK)) assert.equal(e.task[k], v);
  assert.equal(e.task.clean_checkout_claimed, false);
  assert.equal(e.task.original_execution_replayed, false);
  assert.equal(e.restore_authorized, false);
  assert.equal(e.runtime_success_claimed, false);
  assert.equal(e.server_authenticated_receipt_claimed, false);
  assert.equal(e.reviewed_target_uri, TARGET);
  assert.deepEqual(e.reviewed_scenario_ids, [
    'http-reviewed.success-proposed/create', 'http-reviewed.success-proposed/tune',
    'http-reviewed.stale-proposed/stale-version'
  ]);
  assert.equal(e.scope_preconditions.layer_count, 1);
  assert.equal(e.scope_preconditions.runtime_scope_observed, false);
  assert.equal(e.reviewer_role.producer_material_authored_or_repaired, false);
  assert.equal(e.reviewer_role.host_authenticated_delegation_id, null);
  assert.equal(e.reviewer_role.authenticated_content_bound_receipt, null);
  assert(e.capture_limit.includes('not a complete raw host-return capture'));
  for (const [group, base] of [
    ['reviewed_inputs_sha256', PREP], ['reviewed_sources_sha256', WT], ['artifacts_sha256', WT]
  ]) for (const [f, h] of Object.entries(e[group])) checkHash(resolve(base!, f), h as string);
  assert.equal(Object.keys(e.artifacts_sha256).length, 8);
  const v = e.review_evidence;
  assert.equal(v.exit_code, 0);
  assert.equal(e.verdict_sha256, VERDICT_SHA);
  checkHash(v.verdict_file, VERDICT_SHA);
  assert.equal(readFileSync(v.verdict_file, 'utf8'), v.stdout);
  assert.match(v.stdout, /^PASS\nMedium\n/);
  const prefix = join(PREP, 'pending-independent-review/refreshed-http-content');
  const gate = json(prefix + '.syntax-gate.execution.json');
  assert.equal(gate.exit_code, 0);
  assert.equal(gate.stdout, ''); assert.equal(gate.stderr, '');
  assert.equal(readFileSync(prefix + '.syntax-gate.stdout.txt', 'utf8'), '');
  assert.equal(readFileSync(prefix + '.syntax-gate.stderr.txt', 'utf8'), '');
  const reader = json(prefix + '.verdict-read.execution.json');
  assert.deepEqual(reader.argv, ['/bin/cat', v.verdict_file]);
  assert.equal(reader.exit_code, 0);
  assert.equal(reader.stdout_sha256, VERDICT_SHA);
  assert.equal(readFileSync(prefix + '.verdict-read.stdout.txt', 'utf8'), v.stdout);
  assert.equal(readFileSync(prefix + '.verdict-read.stderr.txt', 'utf8'), '');
  const d = json(join(PREP, 'fixture-inputs.json')).proposed_documents_not_yet_in_tests;
  const seed = d['http-reviewed.seed'], update = d['http-reviewed.update'], stale = d['http-reviewed.stale'];
  for (const [text, n, h] of [
    [seed, 294, 'ffd439025ec021a847571f85b5a91871f9fb7c9c7460775c3fa75bf58cb531eb'],
    [update, 294, '32eaf7393a086d45fb014074c3b1cbca0d735c79de9becaa8cec380c46f5db82'],
    [stale, 307, '960b990d8f71d7b9e91f093cfbce9d63e7586a7f4023411b5b84c2056449e8d6']
  ]) { assert.equal(Buffer.byteLength(text as string), n); assert.equal(sha(text as string), h); }
  return { seed, update, stale, envelope: v, suppliedSha: SUPPLIED_SHA, captureLimit: e.capture_limit, roleLimit: e.reviewer_role.limitation };
}

/**
 * Complete on-disk source inventory, not a claim of exhaustive semantic review.
 *
 * COST DESIGN. This is the expensive check (every `.ts` under `src/` plus the
 * pinned toolchain/entry files — hundreds of files, tens of MB of `src/`). It is
 * needed to bind a packet to a revision, but it must not be multiplied by
 * per-file evidence writes inside one mutation: callers run it at most ONCE per
 * mutation preflight via `sourceInventory()` and thread the result into every
 * nested packet check, so a preflight observes a single consistent snapshot and
 * pays for one traversal. `milliseconds`/`bytes_hashed` make that cost auditable.
 */
export interface SourceInventory {
  /** WT-relative path -> sha256 of the file bytes. */
  files: Record<string, string>;
  /** sha256 of the canonical JSON of `files`; the digest a packet pins as `source_sha256`. */
  sha256: string;
  files_hashed: number;
  bytes_hashed: number;
  milliseconds: number;
}

/** One measured inventory pass. Call once per mutation preflight, then thread it. */
export function sourceInventory(): SourceInventory {
  const started = performance.now();
  let bytesHashed = 0;
  const out: Record<string, string> = {};
  function visit(dir: string) {
    for (const f of readdirSync(physical(dir)).sort()) {
      const p = physical(join(dir, f));
      if (lstatSync(p).isDirectory()) visit(p);
      else if (f.endsWith('.ts')) out[relative(WT, p)] = hashFile(p);
    }
  }
  function hashFile(path: string): string {
    const bytes = readFileSync(path);
    bytesHashed += bytes.byteLength;
    return sha(bytes);
  }
  visit(join(WT, 'src'));
  for (const f of [...OWNED, ...AUXILIARY, 'package.json', 'package-lock.json', 'tsconfig.json',
    'node_modules/ts-node/esm/transpile-only.mjs', 'node_modules/fastembed/lib/esm/fastembed.js',
    ...['ts-node', 'typescript', 'fastembed', 'onnxruntime-node', '@ladybugdb/core', '@lancedb/lancedb', 'ts-jest', 'jest']
      .map(p => 'node_modules/' + p + '/package.json')]) {
    out[f] = hashFile(physical(join(WT, f)));
  }
  return {
    files: out,
    sha256: sha(JSON.stringify(out)),
    files_hashed: Object.keys(out).length,
    bytes_hashed: bytesHashed,
    milliseconds: Math.round((performance.now() - started) * 1000) / 1000
  };
}

/** Convenience view for callers that only need the map (one full pass). */
export function sourceHashes(): Record<string, string> {
  return sourceInventory().files;
}

/**
 * Future packets are coordinator-retained REAL reviewer returns, never produced by
 * this runner. Required shape: purpose, task, binding, source_sha256,
 * reviewed_request_sha256 (restore only), verdict_sha256, review_evidence,
 * reviewer_separation:{producer:false,limitation:string}, capture_limit,
 * artifacts_sha256, reader:{exit_code,stdout_file,stderr_file},
 * syntax_gate:{exit_code,stdout_file,stderr_file}, returned_report_file.
 * Each capture also names its real execution_file (exit_code, stdout_sha256;
 * reader argv must be /bin/cat verdict_file). All named files must be hash-pinned.
 *
 * For BOOTSTRAP, `capture_limit` and `reviewer_separation.limitation` are SEMANTIC
 * requirements, not merely non-empty strings: each must carry the phrases published
 * in `bootstrapPacketRequirements().limitations` (selected fields of an actual tool
 * return and not a complete raw host-return capture; no host-authenticated
 * delegation identity and no content-bound provenance). A missing phrase fails
 * closed and names itself, so a coordinator cannot silently drop it.
 * Restore requires restore_authorized=true and runtime_bound=true.
 *
 * BOOTSTRAP additionally requires implementation_review_approved=true,
 * target_uri, the exact `delta` string, and a `model_cache` that proves a
 * COMPLETE supported-model cache rather than a merely non-empty one:
 *
 *   model_cache.model          supported fastembed EmbeddingModel value
 *                              (only 'fast-bge-small-en-v1.5' is currently ruled)
 *   model_cache.source         absolute fastembed `cacheDir` ROOT — NOT the model
 *                              directory. The SDK never reads the root for files;
 *                              it resolves `<source>/<repo with "/" -> "_">` itself,
 *                              which is exactly `sdk_reads_only` in the requirements.
 *   model_cache.files_sha256   {cache-root-relative path -> sha256}; the key set
 *                              must EQUAL the SDK-required files under
 *                              `<source>/<repo with "/" -> "_">/` — the SDK's
 *                              modelFile plus its four tokenizer/config files —
 *                              and each digest must match the real bytes.
 *                              Missing OR extra entries fail closed.
 *   model_cache.model_directory  optional; when present must equal the SDK dir.
 *
 * That key set is derived from the installed SDK (never from memory) and
 * re-derived on every check; see `assertCompleteModelCache`. Nothing is
 * downloaded, initialised or probed to satisfy it.
 * This runner never creates these packets. Checks integrity/context, NOT host
 * authentication or reviewer soundness.
 *
 * @param inventory pre-measured `sourceInventory()` snapshot. Pass it to avoid a
 *   second full-source traversal inside one mutation preflight; omit it only for
 *   the standalone bootstrap call.
 */
export function independentPacket(
  path: string, pin: string, purpose: string, binding: string, inventory?: SourceInventory
) {
  assert(path && pin, `BLOCKED: missing separate ${purpose} judgment/capture pin`);
  physical(path, join(WT, '.local'));
  checkHash(path, pin);
  const p = json(path);
  assert.equal(p.purpose, purpose); assert.equal(p.binding, binding);
  assert.equal(p.target_uri, TARGET);
  if (purpose === 'bootstrap-delta') {
    assert.equal(p.implementation_review_approved, true);
    assert.equal(p.delta, DELTA, 'bootstrap packet must restate the exact execution delta');
    // Fail-closed cache-completeness rule (A2); applied before any model import.
    assertCompleteModelCache(p.model_cache);
    // Fail-closed limitation rule (P2): a non-empty but hollow string no longer passes.
    assertBootstrapLimitations(p);
  } else {
    assert.equal(purpose, 'restore'); assert.equal(p.restore_authorized, true);
    assert.equal(p.runtime_bound, true);
  }
  assert.deepEqual(p.task, TASK);
  if (inventory) {
    assert.equal(inventory.sha256, sha(JSON.stringify(inventory.files)), 'threaded inventory is not self-consistent');
    assert.equal(inventory.files_hashed, Object.keys(inventory.files).length);
  }
  const expected = inventory ? inventory.files : sourceHashes();
  assert.deepEqual(p.source_sha256, expected, 'source/bootstrap/implementation drift requires renewed review');
  assert.equal(p.reviewer_separation.producer, false);
  // Bootstrap limitation SUBSTANCE is enforced above; restore only requires presence.
  if (purpose !== 'bootstrap-delta') {
    assert(p.reviewer_separation.limitation.length > 0 && p.capture_limit.length > 0);
  }
  for (const [f, h] of Object.entries(p.artifacts_sha256)) checkHash(f, h as string);
  const e = p.review_evidence;
  assert.equal(e.exit_code, 0);
  assert.match(e.stdout, /^PASS\n(High|Medium|Low)\n/);
  assert.notEqual(p.verdict_sha256, VERDICT_SHA, 'initial verdict cannot approve bootstrap/restore');
  assert.equal(p.artifacts_sha256[e.verdict_file], p.verdict_sha256);
  checkHash(e.verdict_file, p.verdict_sha256);
  assert.equal(readFileSync(e.verdict_file, 'utf8'), e.stdout);
  for (const capture of [p.reader, p.syntax_gate]) {
    assert.equal(capture.exit_code, 0);
    assert(p.artifacts_sha256[capture.stdout_file] && p.artifacts_sha256[capture.stderr_file]);
    assert(p.artifacts_sha256[capture.execution_file], 'actual command execution capture required');
    const execution = json(capture.execution_file);
    assert.equal(execution.exit_code, capture.exit_code);
    assert.equal(execution.stdout_sha256, sha(readFileSync(capture.stdout_file)));
    if (capture === p.reader) assert.deepEqual(execution.argv, ['/bin/cat', e.verdict_file]);
    assert.equal(readFileSync(capture.stderr_file, 'utf8'), '');
  }
  assert.equal(readFileSync(p.reader.stdout_file, 'utf8'), e.stdout);
  assert(p.artifacts_sha256[p.returned_report_file], 'actual returned fields must be retained');
  return p;
}

/**
 * Containment ONLY: prove the path is a real, symlink-free path inside this task's
 * owned scratch prefix. Runs no isolation verifier and hashes no source, so it is
 * safe to call for every individual evidence write without multiplying the
 * preflight cost (`verifyTask` + `initialEvidence` are the expensive half).
 */
export function ownedPath(path: string): void {
  physical(path, join(WT, '.local'));
  assert(relative(join(WT, '.local'), path).startsWith('http-reviewed-'), 'scratch ownership violation');
}

/** Ownership check at a preflight boundary: one verifier run, then containment. */
export function beforeOwnedWrite(path: string): void {
  verifyTask(); initialEvidence();
  ownedPath(path);
}
