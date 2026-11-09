/**
 * Identity used for graph writes.
 *
 * Resolution order is authenticated subject → runtime sentinel. A document,
 * tool input, or adapter frontmatter can never supply the actor: the value is
 * read from the request-scoped tenant context only (ADR 0045).
 */
import type { GraphActor } from './graph-types.js';
import { getSpaceContextFromStorage } from '../../utils/tenant-context.js';

/** Runtime sentinel when AUTH is disabled and no subject exists. */
export const RUNTIME_LOCAL_ACTOR = 'runtime:local';

/** Resolve the actor for a graph write without ever trusting caller-supplied text. */
export function resolveGraphActor(): GraphActor {
  let subject = '';
  try {
    const context = getSpaceContextFromStorage();
    subject = typeof context.userId === 'string' ? context.userId.trim() : '';
  } catch {
    subject = '';
  }
  return subject.length > 0
    ? { actor: subject, actor_source: 'auth-subject' }
    : { actor: RUNTIME_LOCAL_ACTOR, actor_source: 'runtime-local' };
}
