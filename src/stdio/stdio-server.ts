import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { MemoryQdrantStore } from '../services/memory/store.js';
import { createServer } from '../server.js';
import type { QdrantService } from '../services/qdrant/service.js';
import { structuredLogger } from '../utils/structured-logger.js';

export async function startStdioTransport(
  memoryStore: MemoryQdrantStore,
  service?: QdrantService
): Promise<void> {
  structuredLogger.debug('Starting stdio MCP server (stdout reserved for protocol frames)');

  // The runtime's own retrieval facade when one was booted; the module default only
  // when the caller never booted a runtime.
  const server = createServer(memoryStore, service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
