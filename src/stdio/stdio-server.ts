import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MemoryQdrantStore } from '../services/memory/store.js';
import { createServer } from '../server.js';
import { structuredLogger } from '../utils/structured-logger.js';

export async function startStdioTransport(memoryStore: MemoryQdrantStore): Promise<void> {
  structuredLogger.debug('Starting stdio MCP server (stdout reserved for protocol frames)');

  const server = createServer(memoryStore);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
