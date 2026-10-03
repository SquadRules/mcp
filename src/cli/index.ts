#!/usr/bin/env node
/**
 * SQUADRULES CLI - Command-line interface for interacting with SQUADRULES REST API
 */

import { createProgram } from './program.js';

// Parse arguments (async for commands that perform I/O before spawn, e.g. `serve`)
await createProgram().parseAsync(process.argv);

