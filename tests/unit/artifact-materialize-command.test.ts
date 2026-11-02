/**
 * The materialize instruction emitted in `activate`'s
 * `linked_artifacts[].materialize` carries an exact shell line
 * (SquadRules/mcp#231), so these tests run that line for real: stdio decodes a
 * base64 payload, HTTP curls a listener in this process, and both must land the
 * stored bytes with the digest verified and mode 700.
 */

import { describe, expect, it } from '@jest/globals';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  buildArtifactMaterializeInstruction,
  type MaterializeInstruction
} from '../../src/tools/artifact-materialize-command.js';

/** Deliberately awkward bytes: CRLF line, trailing spaces, non-ASCII, final newline. */
const ARTIFACT_TEXT = '#!/usr/bin/env python3\r\nimport sys  \nprint("ok é")\n';
const ARTIFACT_BYTES = Buffer.from(ARTIFACT_TEXT, 'utf8');
const ARTIFACT_SHA = createHash('sha256').update(ARTIFACT_TEXT, 'utf8').digest('hex');
const ARTIFACT_URI = 'squadrules://artifact/isolation-guard';
const RELATIVE_PATH = 'artifacts/isolation-guard.py';
const CAPABILITY_URL = 'http://127.0.0.1:8000/export/artifact/token.value';
const B64 = ARTIFACT_BYTES.toString('base64');

function httpInstruction(downloadUrl = CAPABILITY_URL): MaterializeInstruction {
  return buildArtifactMaterializeInstruction({
    transport: 'http',
    artifactUri: ARTIFACT_URI,
    downloadUrl,
    relativePath: RELATIVE_PATH,
    sha256: ARTIFACT_SHA
  });
}

function stdioInstruction(sha256 = ARTIFACT_SHA): MaterializeInstruction {
  return buildArtifactMaterializeInstruction({
    transport: 'stdio',
    artifactUri: ARTIFACT_URI,
    downloadUrl: ARTIFACT_URI,
    relativePath: RELATIVE_PATH,
    sha256
  });
}

function newArtifactDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'squadrules-materialize-'));
}

/**
 * Async on purpose: the HTTP case answers from this same process, and a blocking
 * spawn would deadlock the command against its own listener.
 */
function runMaterialize(
  cmd: string,
  dir: string,
  env: Record<string, string> = {}
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], { env: { ...process.env, SQUADRULES_LOCAL_ARTIFACT_DIR: dir, ...env } });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.on('close', (status) => resolve({ status, output }));
  });
}

describe('buildArtifactMaterializeInstruction arguments', () => {
  it('names the export tool with a valid artifact URI on both transports', () => {
    for (const instruction of [httpInstruction(), stdioInstruction()]) {
      expect(instruction.tool).toBe('export');
      expect(instruction.arguments.uri).toBe(ARTIFACT_URI);
      expect(instruction.arguments.format).toBe('source');
      expect(instruction.sha256).toBe(ARTIFACT_SHA);
      expect(instruction.chmod).toBe('700');
      expect(instruction.out).toBe('$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/isolation-guard.py');
    }
  });

  it('never puts a capability URL in the export tool arguments', () => {
    // A capability URL fails the export tool's artifact URI check (issue #231).
    expect(httpInstruction().arguments.uri).not.toContain('/export/');
  });

  it('asks for base64 only where there is no listener to download from', () => {
    expect(stdioInstruction().arguments.delivery).toBe('inline_base64');
    expect(httpInstruction().arguments.delivery).toBeUndefined();
    expect(stdioInstruction().cmd).toContain('base64 -d');
    expect(stdioInstruction().cmd).not.toContain('curl');
    expect(httpInstruction().cmd).toContain('curl -fsS -o');
    expect(httpInstruction().cmd).not.toContain('base64');
  });

  it('creates the parent directory, quotes every path, verifies, then chmods', () => {
    const outRef = '"$SQUADRULES_LOCAL_ARTIFACT_DIR/artifacts/isolation-guard.py"';
    const cmd = httpInstruction().cmd;
    expect(cmd).toContain(`mkdir -p "$(dirname ${outRef})"`);
    expect(cmd).toContain(`curl -fsS -o ${outRef} "${CAPABILITY_URL}"`);
    expect(cmd).toContain(`'${ARTIFACT_SHA}' ${outRef} | sha256sum -c`);
    expect(cmd).toContain(`chmod 700 ${outRef}`);
    expect(stdioInstruction().cmd).toContain(`printf '%s' "$B64" | base64 -d > ${outRef}`);
  });

  it('refuses to run on an empty B64 instead of writing an empty file', () => {
    expect(stdioInstruction().cmd).toContain('${B64:?B64 must hold the export response content field}');
  });
});

describe('materialize cmd executed as emitted', () => {
  it('stdio decodes base64 into the stored bytes with mode 700', async () => {
    const dir = newArtifactDir();
    const run = await runMaterialize(stdioInstruction().cmd, dir, { B64 });

    expect(run.status).toBe(0);
    expect(run.output).toContain(': OK');
    expect(fs.readFileSync(path.join(dir, RELATIVE_PATH)).equals(ARTIFACT_BYTES)).toBe(true);
    expect(fs.statSync(path.join(dir, RELATIVE_PATH)).mode & 0o777).toBe(0o700);
  });

  it('stdio reports the missing B64 and writes nothing', async () => {
    const dir = newArtifactDir();
    const run = await runMaterialize(stdioInstruction().cmd, dir, { B64: '' });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('B64 must hold the export response content field');
    expect(fs.existsSync(path.join(dir, RELATIVE_PATH))).toBe(false);
  });

  it('stdio fails closed when the digest does not match the bytes', async () => {
    const dir = newArtifactDir();
    const run = await runMaterialize(stdioInstruction('b'.repeat(64)).cmd, dir, { B64 });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('FAILED');
  });

  it('http curls the listener into the stored bytes with mode 700', async () => {
    const dir = newArtifactDir();
    const server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/x-python');
      res.end(ARTIFACT_BYTES);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const instruction = httpInstruction(`http://127.0.0.1:${port}/export/artifact/token.value`);

    const run = await runMaterialize(instruction.cmd, dir);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(run.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, RELATIVE_PATH)).equals(ARTIFACT_BYTES)).toBe(true);
    expect(fs.statSync(path.join(dir, RELATIVE_PATH)).mode & 0o777).toBe(0o700);
  });

  it('handles a relative path containing spaces', async () => {
    const dir = newArtifactDir();
    const instruction = buildArtifactMaterializeInstruction({
      transport: 'stdio',
      artifactUri: ARTIFACT_URI,
      downloadUrl: ARTIFACT_URI,
      relativePath: 'my dir/gate script.py',
      sha256: ARTIFACT_SHA
    });

    const run = await runMaterialize(instruction.cmd, dir, { B64 });

    expect(run.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'my dir/gate script.py')).equals(ARTIFACT_BYTES)).toBe(true);
  });
});
