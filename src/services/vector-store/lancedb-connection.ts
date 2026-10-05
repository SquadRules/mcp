/**
 * Strong-consistency connection for the embedded LanceDB store.
 *
 * Each server process opens the shared per-user directory directly (no daemon,
 * no lock). The one property a Qdrant server used to give implicitly - a reader
 * seeing another process's latest commits - must be requested explicitly here:
 * `readConsistencyInterval: 0` makes every read check the latest committed
 * version. Writes are always consistent under MVCC.
 *
 * The SDK is imported lazily inside these functions so that merely loading this
 * module (for example on the Qdrant path, where it is never called) does not
 * pull in native bindings at startup.
 */
import { join } from 'path';
import { getSquadrulesConfigDir } from '../../utils/squadrules-user-dirs.js';

type LanceDbModule = typeof import('@lancedb/lancedb');
export type LanceConnection = Awaited<ReturnType<LanceDbModule['connect']>>;
export type LanceTable = Awaited<ReturnType<LanceConnection['openTable']>>;

/** Resolve the per-user LanceDB directory (derived from the shared config dir). */
export function resolveLanceDbDir(): string {
  return join(getSquadrulesConfigDir(), 'lancedb');
}

/**
 * Open a strong-consistency connection to the embedded store. Reads see other
 * processes' commits; the directory is created on demand by the SDK.
 */
export async function openLanceConnection(databaseDir: string = resolveLanceDbDir()): Promise<LanceConnection> {
  const lancedb = await import('@lancedb/lancedb');
  return lancedb.connect(databaseDir, { readConsistencyInterval: 0 });
}

