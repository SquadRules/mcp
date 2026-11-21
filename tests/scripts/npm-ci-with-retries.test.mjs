import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installWithNetworkRetries, shouldRetryInstall } from '../../scripts/npm-ci-with-retries.mjs';

test('only transient native installer network failures are retried', () => {
  assert.equal(shouldRetryInstall('onnxruntime-node npm error connect ETIMEDOUT 150.171.110.150:443'), true);
  assert.equal(shouldRetryInstall('npm error ENETUNREACH 2603:1061::1'), true);
  assert.equal(shouldRetryInstall('npm error ERESOLVE unable to resolve dependency tree'), false);
  assert.equal(shouldRetryInstall('npm error EINTEGRITY checksum failed'), false);
  assert.equal(shouldRetryInstall('npm error E404 model/package not found'), false);
  assert.equal(shouldRetryInstall('npm error ETIMEDOUT and EINTEGRITY'), false);
});

test('automatically retries temporary native binary install failures', async () => {
  let attempts = 0;
  const delays = [];
  await installWithNetworkRetries({
    run: async () => {
      attempts++;
      return attempts < 3
        ? { code: 1, diagnostic: 'onnxruntime-node: ETIMEDOUT', signal: null }
        : { code: 0, diagnostic: '', signal: null };
    },
    delay: async ms => { delays.push(ms); },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test('fails promptly for an invalid package rather than repeating npm ci', async () => {
  let attempts = 0;
  await assert.rejects(installWithNetworkRetries({
    run: async () => {
      attempts++;
      return { code: 1, diagnostic: 'npm ERR! E404', signal: null };
    },
    delay: async () => {},
  }), /after 1 attempt/);
  assert.equal(attempts, 1);
});
