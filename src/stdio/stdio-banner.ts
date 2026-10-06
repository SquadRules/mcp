/**
 * Startup banner for local simple mode (`stdio` transport).
 *
 * Written to **stderr**, never stdout: stdout carries MCP JSON-RPC frames and any
 * stray byte there breaks the host's parser. The banner exists for two reasons —
 * the default `npx` launch is silent for the first minutes while the embedding
 * model downloads, and a local user otherwise has no way to see which store the
 * process is about to write to.
 */
import {
  AUTH_ENABLED,
  EMBEDDING_PROVIDER,
  FASTEMBED_CACHE_DIR,
  FASTEMBED_MODEL,
  isQdrantConfigured
} from '../config.js';
import { describeRuntimeMode } from '../config/runtime-mode.js';

/**
 * Compose the banner text. The LanceDB directory is passed in rather than resolved
 * here so the function stays free of filesystem side effects and is unit-testable;
 * the caller uses `resolveLanceDbDir()` from the vector-store layer.
 */
export function composeStdioModeBanner(lancedbDir: string): string {
  const lines = [
    `SquadRules MCP - ${describeRuntimeMode('stdio')} local mode (stdio transport)`,
    `  store:      ${
      isQdrantConfigured
        ? 'external Qdrant (not supported in stdio; startup is rejected above)'
        : `embedded LanceDB at ${lancedbDir}`
    }`,
    `  embedding:  EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER}; local model ${FASTEMBED_MODEL} (cache ${FASTEMBED_CACHE_DIR})`,
    `  auth:       ${AUTH_ENABLED ? 'enabled' : 'disabled - single user, writes land in your personal space'}`,
    '  http:       no listener (/api, /ui, metrics and the OAuth callback are unavailable)',
    '  state:      proof-of-work nonces, retry counters and caches are in-memory and lost on restart'
  ];
  return `${lines.join('\n')}\n`;
}
