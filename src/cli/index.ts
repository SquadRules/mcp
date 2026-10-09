#!/usr/bin/env node
/**
 * SQUADRULES CLI - Command-line interface for interacting with SQUADRULES REST API
 */

import { createProgram } from './program.js';

// Bare invocation defaults to `serve` → stdio transport when stdin is NOT a TTY
// (i.e. an MCP host spawned this process with piped stdin). When a human runs
// the bin command at a terminal, show help instead of booting the full server.
if (process.argv.length <= 2 && !process.stdin.isTTY) {
  process.argv.push('serve');
}

// Parse arguments (async for commands that perform I/O before spawn, e.g. `serve`)
await createProgram().parseAsync(process.argv);

