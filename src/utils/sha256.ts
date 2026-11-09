/**
 * SHA-256 hex digest.
 *
 * Lives in `utils`, not in `tools`, because `src/resources/**` must never import
 * `src/tools/**`: boot injection hashes bundled markdown to decide whether the stored
 * adapter is in sync, and it needs the digest without reaching into the tool layer
 * (the layering rule stated in `docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md` Context §3).
 *
 * `src/tools/skill-export/sha256.ts` re-exports this, so the export tools keep their
 * existing import path.
 */
import { createHash } from 'node:crypto';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
