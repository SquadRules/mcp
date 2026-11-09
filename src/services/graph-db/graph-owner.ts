/**
 * Graph ownership: the graph instance belongs to the runtime that booted it.
 *
 * Touchpoint 1 attached the embedded LadybugDB to a module-level singleton and every
 * tool resolved it with `getGraphDbService()`. That makes the graph a process-global
 * selected by an environment path: two stores in one process (a personal embedded
 * runtime and a second isolated one, or two test fixtures) cannot own different
 * graphs, and a tool can silently read a graph that belongs to a different store.
 *
 * The graph is therefore attached to the store object it was opened for. Tools
 * resolve it from the store they were handed:
 *
 *     const graphDb = getGraphDb(memoryStore);
 *
 * A `WeakMap` keeps the attachment off the store's public shape and lets both
 * objects be collected together — no lifecycle owner, no leak, no reset hook.
 * There is deliberately no fallback to a global instance here: an unattached store
 * means "no graph bookkeeping for this store", which every call site already
 * degrades to.
 */
import type { GraphRepository } from './graph-repository.js';

const attachments = new WeakMap<object, GraphRepository>();

/**
 * Attach `graphDb` to every owner the runtime hands to tools (the memory store and
 * the retrieval surface it exposes). Passing `null` clears the attachment, which is
 * what a degraded boot does when the graph could not be opened.
 *
 * Owners are the runtime's own objects: a second runtime in the same process attaches
 * its own graph to its own store, so neither can read the other's topology.
 */
export function attachGraphDb(
  graphDb: GraphRepository | null | undefined,
  ...owners: object[]
): void {
  for (const owner of owners) {
    if (graphDb) {
      attachments.set(owner, graphDb);
    } else {
      attachments.delete(owner);
    }
  }
}

/**
 * The graph owned by `owner`, or `null` when this store has none (never booted,
 * disabled, failed to open, or already detached). Returns `null` for a service that
 * is no longer initialized so callers keep their single "no graph" branch.
 */
export function getGraphDb(owner: object | null | undefined): GraphRepository | null {
  if (!owner) return null;
  const graphDb = attachments.get(owner);
  if (!graphDb) return null;
  return graphDb.isInitialized() ? graphDb : null;
}

/** Detach without closing — the caller that opened the graph owns the close. */
export function detachGraphDb(owner: object): void {
  attachments.delete(owner);
}
