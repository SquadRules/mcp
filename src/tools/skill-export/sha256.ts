/**
 * SHA-256 hex digest — compatibility re-export.
 *
 * The implementation moved to `src/utils/sha256.ts` so `src/resources/**` can hash
 * bundled markdown without importing `src/tools/**` (layering rule recorded in
 * `docs/adr/0042-graph-owned-by-runtime-scoped-keys-derived-topology.md` Context §3).
 * The export tools keep importing from here, unchanged.
 */
export { sha256Hex } from '../../utils/sha256.js';
