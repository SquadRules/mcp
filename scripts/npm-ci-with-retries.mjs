#!/usr/bin/env node
/**
 * Run npm ci with bounded retries for transient download failures, including
 * native binary downloads performed by dependency postinstall scripts.
 * Do not retry E404, integrity, dependency-resolution or compilation failures.
 *
 * npm's fetch-retries cannot control arbitrary postinstall network requests.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const NETWORK_ERROR = /\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|socket hang up)\b/i;
const PERMANENT_ERROR = /\b(?:EINTEGRITY|ERESOLVE|E404|ENOTFOUND|ERR_INVALID|EBADENGINE)\b/i;

export function shouldRetryInstall(output) {
  return NETWORK_ERROR.test(output) && !PERMANENT_ERROR.test(output);
}

export function executeInstall(command = 'npm', args = ['ci']) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
    let diagnostic = '';
    function output(stream, destination) {
      stream.on('data', (chunk) => {
        destination.write(chunk);
        diagnostic = (diagnostic + chunk.toString()).slice(-65536);
      });
    }
    output(child.stdout, process.stdout);
    output(child.stderr, process.stderr);
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, diagnostic }));
  });
}

export async function installWithNetworkRetries({ run = executeInstall, delay = sleep, maxAttempts = 3 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await run();
    if (result.code === 0) return;
    if (!shouldRetryInstall(result.diagnostic) || attempt === maxAttempts) {
      throw new Error(`npm ci failed after ${attempt} attempt(s) (exit ${result.code ?? result.signal})`);
    }
    const pause = 2000 * 2 ** (attempt - 1);
    console.error(`npm ci: transient network failure on attempt ${attempt}/${maxAttempts}; retrying in ${pause}ms`);
    await delay(pause);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  installWithNetworkRetries().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
