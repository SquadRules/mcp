/**
 * Inheritance checkpoint service — process/retry recovery for ancestry resolution.
 *
 * WHAT THIS IS
 * A local, owner-instance record of which ancestry stages an execution has already
 * resolved, written **as each stage resolves** so a crash or a retry does not start the
 * walk from nothing. It is recovery metadata only.
 *
 * WHAT THIS IS NOT
 * A checkpoint is **not a proof**. It never satisfies a contract, never marks a layer
 * verified, and never substitutes for a `shell`/`subagent`/`comment` solution. Losing
 * every checkpoint costs re-work, not correctness. Nothing here is surfaced to the
 * agent: the resume token is a hex digest, and no server filesystem path is ever put in
 * a tool response.
 *
 * WHAT IT DOES NOT CLAIM
 * It does not restore model context. A resumed execution recovers the ancestry state a
 * previous process had written; the agent's conversation is whatever the host still
 * holds. Only process/retry recovery is proven by the integration suite.
 *
 * OWNERSHIP AND STALENESS
 * The directory belongs to one runtime instance (it is derived from that runtime's graph
 * directory, overridable). A checkpoint is keyed by execution id and carries the scope
 * id, adapter slug, and every stage's version + content digest. `load()` resumes only a
 * state whose identity matches the caller's; an expired or mismatched file is deleted
 * and reported as `stale` with an explicit reason, never silently reused.
 *
 * ATOMICITY
 * Each stage write goes to a temporary file in the same directory and is renamed into
 * place, so a reader either sees the previous complete state or the new one — never a
 * half-written JSON document.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256Hex } from '../../utils/sha256.js';
import { resolveInheritanceCheckpointDir, INHERITANCE_CHECKPOINT_TTL_MS } from '../../config/graph-db.js';

/** On-disk format version; a file from another version is stale, not parsed hopefully. */
export const CHECKPOINT_VERSION = 1;

/** One resolved ancestry stage (one adapter level). */
export interface CheckpointStage {
  slug: string;
  version: string;
  /** Space the stage's record lives in — part of the resume identity. */
  space_id: string;
  layer_index: number;
  /** SHA-256 of the resolved stage content. */
  content_sha256: string;
  recorded_at: string;
}

export interface InheritanceCheckpoint {
  checkpoint_version: number;
  execution_id: string;
  scope_id: string;
  adapter_slug: string;
  created_at: string;
  updated_at: string;
  /** Root-first stages resolved so far. */
  stages: CheckpointStage[];
  /** True once the walk finished; terminal checkpoints are removed, not kept. */
  complete: boolean;
}

/** Who the checkpoint belongs to. A mismatch is stale, never resumed. */
export interface CheckpointIdentity {
  execution_id: string;
  scope_id: string;
  adapter_slug: string;
}

export interface CheckpointStageInput {
  slug: string;
  version: string;
  space_id: string;
  layer_index: number;
  /** Resolved markdown content of this stage. Hashed before it is written. */
  content: string;
}

export type CheckpointLoadResult =
  | { status: 'missing' }
  | { status: 'resumed'; checkpoint: InheritanceCheckpoint; token: string }
  | { status: 'stale'; reason: string };

export interface InheritanceCheckpointOptions {
  /** Owner-instance directory. Defaults to the runtime's own checkpoint dir. */
  directory?: string;
  /** Time-to-live for an abandoned checkpoint. Defaults to the config value. */
  ttlMs?: number;
  /** Clock injection for TTL tests; production uses the real clock. */
  now?: () => number;
}

/** Resume token: a digest of the identity and stage digests. No server paths inside. */
export function checkpointToken(checkpoint: InheritanceCheckpoint): string {
  const material = [
    `v${checkpoint.checkpoint_version}`,
    checkpoint.execution_id,
    checkpoint.scope_id,
    checkpoint.adapter_slug,
    ...checkpoint.stages.map(
      (stage) => `${stage.slug}@${stage.version}#${stage.content_sha256}`
    )
  ].join('\n');
  return sha256Hex(material);
}

/** Filename for one execution. Execution ids are UUID-shaped by construction. */
function fileNameFor(executionId: string): string {
  return `inheritance-${executionId}.json`;
}

export class InheritanceCheckpointService {
  private readonly directory: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: InheritanceCheckpointOptions = {}) {
    this.directory = options.directory ?? resolveInheritanceCheckpointDir();
    this.ttlMs = options.ttlMs ?? INHERITANCE_CHECKPOINT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Directory this instance owns. Exposed for operators, never for tool output. */
  getDirectory(): string {
    return this.directory;
  }

  private pathFor(executionId: string): string {
    return join(this.directory, fileNameFor(executionId));
  }

  private async readCheckpoint(executionId: string): Promise<InheritanceCheckpoint | null> {
    try {
      const raw = await readFile(this.pathFor(executionId), 'utf8');
      const parsed = JSON.parse(raw) as InheritanceCheckpoint;
      if (!parsed || parsed.checkpoint_version !== CHECKPOINT_VERSION) return null;
      if (parsed.execution_id !== executionId) return null;
      if (!Array.isArray(parsed.stages)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Atomic write: temp file in the same directory, then rename. */
  private async writeCheckpoint(checkpoint: InheritanceCheckpoint): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.pathFor(checkpoint.execution_id);
    const temp = join(this.directory, `.${fileNameFor(checkpoint.execution_id)}.${randomUUID()}.tmp`);
    await writeFile(temp, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
    await rename(temp, target);
  }

  /**
   * Record one resolved ancestry stage.
   *
   * Creates the checkpoint on the first stage. Re-recording the same slug replaces its
   * stage in place, so a retry that resolves a stage twice keeps one entry and one
   * stable token. Returns the resume token of the state now on disk.
   */
  async recordStage(identity: CheckpointIdentity, stage: CheckpointStageInput): Promise<string> {
    const existing = await this.readCheckpoint(identity.execution_id);
    const timestamp = new Date(this.now()).toISOString();
    const checkpoint: InheritanceCheckpoint =
      existing &&
      existing.scope_id === identity.scope_id &&
      existing.adapter_slug === identity.adapter_slug
        ? { ...existing, updated_at: timestamp }
        : {
            checkpoint_version: CHECKPOINT_VERSION,
            execution_id: identity.execution_id,
            scope_id: identity.scope_id,
            adapter_slug: identity.adapter_slug,
            created_at: timestamp,
            updated_at: timestamp,
            stages: [],
            complete: false
          };

    const nextStage: CheckpointStage = {
      slug: stage.slug,
      version: stage.version,
      space_id: stage.space_id,
      layer_index: stage.layer_index,
      content_sha256: sha256Hex(stage.content),
      recorded_at: timestamp
    };
    const withoutStage = checkpoint.stages.filter((entry) => entry.slug !== stage.slug);
    checkpoint.stages = [...withoutStage, nextStage];
    checkpoint.complete = false;
    await this.writeCheckpoint(checkpoint);
    return checkpointToken(checkpoint);
  }

  /**
   * Load a checkpoint for this identity.
   *
   * - `missing`  — nothing recorded (first run, or already cleaned up).
   * - `resumed`  — identity matches and the state is inside its TTL.
   * - `stale`    — deleted with an explicit reason: expired, identity mismatch, or
   *                unreadable/foreign format. Never returned as `resumed`.
   */
  async load(identity: CheckpointIdentity): Promise<CheckpointLoadResult> {
    const checkpoint = await this.readCheckpoint(identity.execution_id);
    if (!checkpoint) return { status: 'missing' };

    if (checkpoint.scope_id !== identity.scope_id) {
      await this.clear(identity.execution_id);
      return {
        status: 'stale',
        reason: `checkpoint scope "${checkpoint.scope_id}" does not match "${identity.scope_id}"`
      };
    }
    if (checkpoint.adapter_slug !== identity.adapter_slug) {
      await this.clear(identity.execution_id);
      return {
        status: 'stale',
        reason: `checkpoint adapter "${checkpoint.adapter_slug}" does not match "${identity.adapter_slug}"`
      };
    }
    if (this.ttlMs > 0 && this.now() - Date.parse(checkpoint.updated_at) > this.ttlMs) {
      await this.clear(identity.execution_id);
      return {
        status: 'stale',
        reason: `checkpoint older than ${Math.round(this.ttlMs / 1000)}s was discarded`
      };
    }

    return { status: 'resumed', checkpoint, token: checkpointToken(checkpoint) };
  }

  /**
   * Compare a previously stored checkpoint with the ancestry the caller just resolved.
   *
   * `prior` MUST be the state read *before* this execution recorded its own stages.
   * Reconciling against post-walk state would compare the walk with itself and could
   * never report a changed ancestor — which is exactly what "resume only matching
   * state" has to detect.
   *
   * Every stored stage must still exist at the same version and content digest. A
   * changed ancestor (new version, edited body) invalidates the checkpoint and says
   * exactly which slug changed.
   */
  async reconcile(
    identity: CheckpointIdentity,
    resolved: CheckpointStageInput[],
    prior?: CheckpointLoadResult
  ): Promise<CheckpointLoadResult> {
    const loaded = prior ?? (await this.load(identity));
    if (loaded.status !== 'resumed') return loaded;

    for (const stage of loaded.checkpoint.stages) {
      const current = resolved.find((entry) => entry.slug === stage.slug);
      if (!current) {
        await this.clear(identity.execution_id);
        return {
          status: 'stale',
          reason: `checkpoint stage "${stage.slug}" is no longer in the resolved ancestry`
        };
      }
      const digest = sha256Hex(current.content);
      if (current.version !== stage.version || digest !== stage.content_sha256) {
        await this.clear(identity.execution_id);
        return {
          status: 'stale',
          reason: `checkpoint stage "${stage.slug}" changed (version or content digest differs)`
        };
      }
    }

    return loaded;
  }

  /** Terminal cleanup: remove the checkpoint for one execution. Idempotent. */
  async clear(executionId: string): Promise<void> {
    await rm(this.pathFor(executionId), { force: true });
  }

  /** Terminal cleanup after a successful walk; the state is no longer needed. */
  async finish(identity: CheckpointIdentity): Promise<void> {
    await this.clear(identity.execution_id);
  }

  /**
   * Delete every expired checkpoint in this owner directory.
   *
   * Called on boot so an abandoned execution cannot accumulate files forever. Returns
   * the number removed; unreadable files are counted and removed too — a corrupt
   * checkpoint has no recovery value.
   */
  async sweepExpired(): Promise<number> {
    let removed = 0;
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return 0;
    }
    const now = this.now();
    for (const entry of entries) {
      if (!entry.startsWith('inheritance-') || !entry.endsWith('.json')) continue;
      const executionId = entry.slice('inheritance-'.length, -'.json'.length);
      const checkpoint = await this.readCheckpoint(executionId);
      const expired =
        !checkpoint || (this.ttlMs > 0 && now - Date.parse(checkpoint.updated_at) > this.ttlMs);
      if (expired) {
        await this.clear(executionId);
        removed++;
      }
    }
    return removed;
  }
}

/**
 * A checkpoint service for one runtime instance.
 *
 * Constructed on demand rather than memoized: the service holds no connection, and a
 * caller that passes an explicit `directory` (a second embedded runtime, a test fixture)
 * must get its own directory rather than a process-wide one.
 */
export function createInheritanceCheckpointService(
  options: InheritanceCheckpointOptions = {}
): InheritanceCheckpointService {
  return new InheritanceCheckpointService(options);
}
