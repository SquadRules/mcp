/**
 * Jest setupFile: install the same Qdrant fetch compatibility shim the server installs at boot.
 *
 * `@qdrant/js-client-rest` injects an `undici` Agent from its own dependency tree as the
 * `dispatcher` of every fetch init. Inside the Jest VM context that foreign dispatcher is
 * rejected by the runtime's built-in fetch (`InvalidArgumentError: invalid onRequestStart
 * method`, surfaced as `TypeError: fetch failed`), so any suite that talks to Qdrant in-process
 * fails on Node 24 even when Qdrant is healthy. `src/index.ts` already strips the field for the
 * server process (see src/services/qdrant/undici-compat.ts); a test process never boots the
 * server, so it has to opt in the same way.
 */
import { installQdrantFetchCompatibility } from '../src/services/qdrant/undici-compat.js';

installQdrantFetchCompatibility();
