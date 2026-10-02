#!/usr/bin/env node
/**
 * Journey export script.
 *
 * Reads the audit log JSONL file produced by SQUADRULES MCP server and exports
 * journey JSON files grouped by correlation_id.
 *
 * Usage:
 *   node scripts/journey-export.mjs --input ./audit.jsonl --out ./journeys/
 *
 * Options:
 *   --input <path>       Path to the audit log JSONL file (required)
 *   --out <dir>          Output directory for journey JSON files (default: ./journeys/)
 *   --correlation <id>   Export only one correlation group
 *   --session <id>       Alias for --correlation (backwards compat)
 *   --redact             Strip tenant_id values and secrets (for sharing externally)
 *   --min-tools <n>      Skip sessions with fewer than n tool calls (filter noise)
 *   --help               Show this help message
 */

import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, join, resolve } from 'node:path';

// ── CLI argument parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name, required = false) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  if (!val || val.startsWith('--')) {
    console.error(`Error: --${name} requires a value`);
    process.exit(1);
  }
  return val;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

if (hasFlag('help')) {
  console.log(`
Journey export: audit JSONL → journey JSON files

Usage:
  node scripts/journey-export.mjs --input ./audit.jsonl --out ./journeys/

Options:
  --input <path>       Path to the audit log JSONL file (required)
  --out <dir>          Output directory for journey JSON files (default: ./journeys/)
  --correlation <id>   Export only one correlation group
  --session <id>       Alias for --correlation (backwards compat)
  --redact             Strip tenant_id values and secrets (for sharing externally)
  --min-tools <n>      Skip sessions with fewer than n tool calls (filter noise)
  --help               Show this help message
`);
  process.exit(0);
}

const inputPath = getArg('input', true);
const outDir = resolve(getArg('out') || './journeys/');
const filterCorrelation = getArg('correlation') || getArg('session');
const redactMode = hasFlag('redact');
const minTools = parseInt(getArg('min-tools') || '0', 10);

if (!inputPath) {
  console.error('Error: --input is required');
  process.exit(1);
}

// ── Secret redaction ─────────────────────────────────────────────────────────
// NOTE: Keep in sync with src/utils/audit-secret-patterns.ts (source of truth)
// This script is standalone (node, not TypeScript) so patterns are duplicated here.

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bsk-[A-Za-z0-9]{20,}/gi,
  /\bghp_[A-Za-z0-9]{36}/gi,
  /\bgho_[A-Za-z0-9]{36}/gi,
  /\bglpat-[A-Za-z0-9\-]{20,}/gi,
  /\bxox[baprs]-[A-Za-z0-9\-]+/gi,
  /AIza[A-Za-z0-9\-_]{35}/gi,
];

function redactSecrets(value) {
  if (typeof value !== 'string') return value;
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function redactObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return typeof obj === 'string' ? redactSecrets(obj) : obj;
  if (Array.isArray(obj)) return obj.map(redactObject);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'tenant_id' && typeof v === 'string') {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactObject(v);
    }
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading audit log: ${inputPath}`);
  console.log(`Output directory: ${outDir}`);

  await mkdir(outDir, { recursive: true });

  // Group events by correlation_id
  const groups = new Map();
  let lineCount = 0;
  let mcpLineCount = 0;

  const stream = createReadStream(inputPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // Skip malformed lines
    }

    if (record.category !== 'audit.mcp') continue;
    mcpLineCount++;

    const correlationId = record.correlation_id;
    if (!correlationId) continue;

    // Apply correlation filter if specified
    if (filterCorrelation && correlationId !== filterCorrelation) continue;

    if (!groups.has(correlationId)) {
      groups.set(correlationId, {
        correlation_id: correlationId,
        tenant_id: record.tenant_id || 'unknown',
        server_version: record.server_version || 'unknown',
        started_at: record.time,
        ended_at: record.time,
        events: [],
        requestStart: null,
        requestEnd: null,
        toolCalls: []
      });
    }

    const group = groups.get(correlationId);

    // Track time bounds
    if (record.time < group.started_at) group.started_at = record.time;
    if (record.time > group.ended_at) group.ended_at = record.time;

    if (record.event === 'mcp_request_start') {
      group.requestStart = record;
    } else if (record.event === 'mcp_request_end') {
      group.requestEnd = record;
    } else if (record.event === 'mcp_tool_call') {
      group.toolCalls.push(record);
    }

    // Keep raw event for full export
    group.events.push(record);
  }

  console.log(`Parsed ${lineCount} lines, ${mcpLineCount} MCP audit events`);
  console.log(`Found ${groups.size} correlation groups`);

  // Export each group as a journey JSON
  let exportedCount = 0;
  let skippedCount = 0;

  for (const [correlationId, group] of groups) {
    // Apply min-tools filter
    if (group.toolCalls.length < minTools) {
      skippedCount++;
      continue;
    }

    // Build tool sequence summary
    const toolSequence = group.toolCalls.map((tc) => tc.tool_name);

    // Compute duration from start/end events or time bounds
    const startMs = group.requestStart ? new Date(group.requestStart.time).getTime() : new Date(group.started_at).getTime();
    const endMs = group.requestEnd ? new Date(group.requestEnd.time).getTime() : new Date(group.ended_at).getTime();
    const durationMs = endMs - startMs;

    const journey = {
      meta: {
        correlation_id: correlationId,
        tenant_id: redactMode ? '[REDACTED]' : group.tenant_id,
        server_version: group.server_version,
        started_at: group.started_at,
        ended_at: group.ended_at,
        tool_count: group.toolCalls.length,
        duration_ms: durationMs,
        tool_sequence: toolSequence
      },
      events: group.toolCalls.map((tc, idx) => {
        const event = {
          seq: idx,
          timestamp: tc.time,
          tool_name: tc.tool_name,
          status: tc.status || 'unknown',
          duration_ms: tc.duration_ms
        };
        if (tc.request_id) event.request_id = tc.request_id;
        if (tc.error_code) event.error_code = tc.error_code;
        if (tc.request) event.request = redactMode ? redactObject(tc.request) : tc.request;
        if (tc.response) event.response = redactMode ? redactObject(tc.response) : tc.response;
        return event;
      })
    };

    const filename = `${correlationId}.json`;
    const filepath = join(outDir, filename);
    await writeFile(filepath, JSON.stringify(journey, null, 2) + '\n');
    exportedCount++;
    console.log(`  Exported: ${filename} (${group.toolCalls.length} tools, ${durationMs}ms)`);
  }

  console.log(`\nDone. Exported ${exportedCount} journeys, skipped ${skippedCount} (below --min-tools threshold).`);
}

main().catch((err) => {
  console.error('Journey export failed:', err);
  process.exit(1);
});
