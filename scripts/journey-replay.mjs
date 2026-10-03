#!/usr/bin/env node
/**
 * Journey replay: replays an exported journey JSON against a running SQUADRULES MCP server.
 * Sends each tool call in sequence and runs consistency checks.
 * Usage: node scripts/journey-replay.mjs --journey ./journeys/corr-abc.json --server http://localhost:3300
 * Options: --journey <path> --server <url> --bearer <token> --strict --redact-tenant <id> --dry-run --help
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// CLI argument parsing
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
  console.log('Journey replay: replay exported journey against a SQUADRULES server\n\nUsage:\n  node scripts/journey-replay.mjs --journey ./journeys/corr-abc.json --server http://localhost:3300\n\nOptions: --journey <path> --server <url> --bearer <token> --strict --redact-tenant <id> --dry-run --help');
  process.exit(0);
}

const journeyPath = resolve(getArg('journey') || '');
const serverUrl = (getArg('server') || '').replace(/\/$/, '');
const bearerToken = getArg('bearer') || process.env.JOURNEY_BEARER_TOKEN || '';
const strictMode = hasFlag('strict');
const dryRun = hasFlag('dry-run');

if (!journeyPath || !getArg('journey')) {
  console.error('Error: --journey is required');
  process.exit(1);
}
if (!serverUrl && !dryRun) {
  console.error('Error: --server is required (or use --dry-run)');
  process.exit(1);
}

// ── MCP JSON-RPC client ──────────────────────────────────────────────────────

let jsonRpcId = 0;

async function mcpToolCall(toolName, toolArgs) {
  const body = {
    jsonrpc: '2.0',
    id: ++jsonRpcId,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: toolArgs
    }
  };

  const headers = { 'Content-Type': 'application/json' };
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

  const res = await fetch(`${serverUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }

  const rpcResponse = await res.json();
  if (rpcResponse.error) {
    return { isError: true, error: rpcResponse.error };
  }
  return rpcResponse.result || {};
}

async function mcpToolsList() {
  const body = {
    jsonrpc: '2.0',
    id: ++jsonRpcId,
    method: 'tools/list',
    params: {}
  };

  const headers = { 'Content-Type': 'application/json' };
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

  const res = await fetch(`${serverUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) return [];
  const rpcResponse = await res.json();
  return rpcResponse.result?.tools || [];
}

// ── Consistency checks ───────────────────────────────────────────────────────

function checkToolExists(toolName, availableTools) {
  return availableTools.some((t) => t.name === toolName);
}

function checkStatusMatch(expectedStatus, actualResult) {
  const actualIsError = actualResult?.isError === true;
  if (expectedStatus === 'error') return actualIsError;
  return !actualIsError;
}

function checkSchemaShape(expectedResponse, actualResult) {
  if (!expectedResponse || !actualResult) return { match: true, diffs: [] };
  const diffs = [];

  // Compare top-level keys and their types
  const expectedKeys = Object.keys(expectedResponse).sort();
  const actualKeys = Object.keys(actualResult).sort();

  for (const key of expectedKeys) {
    if (!actualKeys.includes(key)) {
      diffs.push(`missing field "${key}"`);
    } else {
      // Validate type match
      const expectedType = typeof expectedResponse[key];
      const actualType = typeof actualResult[key];
      if (expectedType !== actualType) {
        diffs.push(`field "${key}" type mismatch: expected ${expectedType}, got ${actualType}`);
      }
      // Check array shape if both are arrays
      if (Array.isArray(expectedResponse[key]) && Array.isArray(actualResult[key])) {
        if (expectedResponse[key].length > 0 && actualResult[key].length === 0) {
          diffs.push(`field "${key}" array is empty but expected items`);
        }
      }
    }
  }

  // Check content array shape if present
  if (expectedResponse.content && actualResult.content) {
    if (!Array.isArray(actualResult.content)) {
      diffs.push('content is not an array');
    } else if (expectedResponse.content.length > 0 && actualResult.content.length === 0) {
      diffs.push('content array is empty but expected items');
    }
  }

  return { match: diffs.length === 0, diffs };
}

function checkErrorCodeMatch(expectedErrorCode, actualResult) {
  if (!expectedErrorCode) return true;
  return JSON.stringify(actualResult).includes(expectedErrorCode);
}

// Check if response body matches recorded response (level 3 exact replay), skipping dynamic fields
function checkExactMatch(expectedResponse, actualResult) {
  if (!expectedResponse || !actualResult) return { match: true, diffs: [] };
  const diffs = [];

  // Fields that are dynamic and should be skipped in exact comparison
  const dynamicFields = new Set([
    'execution_id', 'nonce', 'proof_hash', 'created_at', 'updated_at',
    'timestamp', 'request_id', 'correlation_id', 'duration_ms'
  ]);

  function compareObjects(expected, actual, path = '') {
    if (!expected || !actual) {
      if (expected !== actual) diffs.push(`${path || 'root'}: ${expected} !== ${actual}`);
      return;
    }

    if (typeof expected !== typeof actual) {
      diffs.push(`${path}: type mismatch ${typeof expected} !== ${typeof actual}`);
      return;
    }

    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || expected.length !== actual.length) {
        diffs.push(`${path}: array length mismatch`);
        return;
      }
      for (let i = 0; i < expected.length; i++) {
        compareObjects(expected[i], actual[i], `${path}[${i}]`);
      }
      return;
    }

    if (typeof expected === 'object') {
      const expectedKeys = Object.keys(expected);
      const actualKeys = Object.keys(actual);

      for (const key of expectedKeys) {
        if (dynamicFields.has(key)) continue; // Skip dynamic fields
        const fullPath = path ? `${path}.${key}` : key;
        if (!actualKeys.includes(key)) {
          diffs.push(`${fullPath}: missing`);
        } else {
          compareObjects(expected[key], actual[key], fullPath);
        }
      }
      return;
    }

    if (expected !== actual) {
      diffs.push(`${path}: ${JSON.stringify(expected)} !== ${JSON.stringify(actual)}`);
    }
  }

  compareObjects(expectedResponse, actualResult);
  return { match: diffs.length === 0, diffs };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Loading journey: ${journeyPath}`);
  const journeyContent = await readFile(journeyPath, 'utf8');
  const journey = JSON.parse(journeyContent);

  const { meta, events } = journey;
  console.log(`Journey: ${meta.correlation_id} (${meta.tool_count} tools, tenant: ${meta.tenant_id})`);
  console.log(`Tool sequence: ${meta.tool_sequence?.join(' → ') || 'unknown'}`);
  console.log('');

  if (dryRun) {
    console.log('Dry run: journey file is valid. Events:');
    for (const event of events) {
      console.log(`  [${event.seq}] ${event.tool_name} (${event.status})`);
    }
    return;
  }

  // Fetch available tools from server
  console.log(`Connecting to: ${serverUrl}`);
  const availableTools = await mcpToolsList();
  console.log(`Server has ${availableTools.length} tools available\n`);

  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;
  const results = [];

  for (const event of events) {
    const checks = [];
    let hasFailure = false;

    // Check 1: tool-exists (level 1+)
    const toolExists = checkToolExists(event.tool_name, availableTools);
    if (toolExists) {
      checks.push('tool exists');
    } else {
      checks.push('FAIL: tool not found on server');
      hasFailure = true;
    }

    if (!toolExists || !event.request) {
      // Can't replay without tool or request args
      const status = hasFailure ? 'FAIL' : 'SKIP';
      console.log(`  [${status}] ${event.tool_name.padEnd(12)} - ${checks.join(', ')}`);
      if (hasFailure) failCount++;
      else warnCount++;
      results.push({ event: event.tool_name, status, checks });
      continue;
    }

    // Execute the tool call
    let actualResult;
    try {
      actualResult = await mcpToolCall(event.tool_name, event.request);
    } catch (err) {
      checks.push(`FAIL: request error: ${err.message}`);
      hasFailure = true;
      console.log(`  [FAIL] ${event.tool_name.padEnd(12)} - ${checks.join(', ')}`);
      failCount++;
      results.push({ event: event.tool_name, status: 'FAIL', checks });
      continue;
    }

    // Check 2: status-match (level 1+)
    const statusMatch = checkStatusMatch(event.status, actualResult);
    if (statusMatch) {
      checks.push('status match');
    } else {
      checks.push(`FAIL: status mismatch (expected ${event.status})`);
      hasFailure = true;
    }

    // Check 3: error-code-match (level 1+)
    if (event.error_code) {
      const errorCodeMatch = checkErrorCodeMatch(event.error_code, actualResult);
      if (errorCodeMatch) {
        checks.push('error code match');
      } else {
        checks.push(`WARN: error code mismatch (expected ${event.error_code})`);
        warnCount++;
      }
    }

    // Check 4: schema-shape (level 2+)
    if (event.response) {
      const shapeResult = checkSchemaShape(event.response, actualResult);
      if (shapeResult.match) {
        checks.push('schema match');
      } else {
        checks.push(`FAIL: schema drift: ${shapeResult.diffs.join(', ')}`);
        hasFailure = true;
      }

      // Check 5: exact-match (level 3 only)
      if (event.response && event.response.content) {
        const exactResult = checkExactMatch(event.response, actualResult);
        if (exactResult.match) {
          checks.push('exact match');
        } else {
          checks.push(`WARN: exact drift: ${exactResult.diffs.slice(0, 3).join(', ')}${exactResult.diffs.length > 3 ? '...' : ''}`);
          warnCount++;
        }
      }
    }

    const status = hasFailure ? 'FAIL' : 'PASS';
    if (hasFailure) failCount++;
    else passCount++;

    console.log(`  [${status}] ${event.tool_name.padEnd(12)} - ${checks.join(', ')}`);
    results.push({ event: event.tool_name, status, checks });
  }

  // Summary
  console.log(`\nResult: ${passCount}/${events.length} passed, ${failCount} failed, ${warnCount} warnings`);

  if (strictMode && failCount > 0) {
    console.log('\nStrict mode: exiting with code 1 due to drift');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Journey replay failed:', err);
  process.exit(1);
});
