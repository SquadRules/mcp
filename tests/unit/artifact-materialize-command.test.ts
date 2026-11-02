/**
 * The materialize instruction emitted in `activate`'s
 * `linked_artifacts[].materialize` carries an exact shell line (ADR 0040,
 * SquadRules/mcp#231), so these tests run that line for real: a `file://` cache
 * path (stdio) and an in-process HTTP listener (HTTP capability URL) feed the
 * same transport-neutral `curl` command, and both must land the stored bytes with
 * the digest verified, mode 700, and an atomic publish that never clobbers a
 * prior destination on failure.
 */

import { describe, expect, it } from '@jest/globals';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildArtifactMaterializeInstruction,
  shellSingleQuote,
  SQUADRULES_LOCAL_ARTIFACT_DIR_ENV,
  type MaterializeInstruction
} from '../../src/tools/artifact-materialize-command.js';

/** Deliberately awkward bytes: CRLF line, trailing spaces, non-ASCII, final newline. */
const ARTIFACT_TEXT = '#!/usr/bin/env python3\r\nimport sys  \nprint("ok é")\n';
const ARTIFACT_BYTES = Buffer.from(ARTIFACT_TEXT, 'utf8');
const ARTIFACT_SHA = createHash('sha256').update(ARTIFACT_BYTES).digest('hex');
const RELATIVE_PATH = 'artifacts/isolation-guard.py';
const OUT_REF = `$SQUADRULES_LOCAL_ARTIFACT_DIR/${RELATIVE_PATH}`;

/** Write the artifact bytes to a fresh temp file and return its path + `file://` URL. */
function writeFileSource(): { file: string; url: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'squadrules-src-')), 'isolation-guard.py');
  fs.writeFileSync(file, ARTIFACT_BYTES);
  return { file, url: pathToFileURL(file).href };
}

function fileInstruction(sha256 = ARTIFACT_SHA, relativePath = RELATIVE_PATH): MaterializeInstruction {
  const { url } = writeFileSource();
  return buildArtifactMaterializeInstruction({ url, relativePath, sha256 });
}

function newArtifactDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'squadrules-materialize-'));
}

/** Staging files left behind anywhere under `dir` (the trap must remove them). */
function stagingLeftovers(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.startsWith('.squadrules-materialize.')) found.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

/**
 * Run the emitted line with `sh -c`, controlling SQUADRULES_LOCAL_ARTIFACT_DIR
 * exactly: pass a string to set it, or `null` to leave it unset. Async on purpose
 * so the HTTP case can answer from this same process without deadlocking.
 */
function runMaterialize(
  cmd: string,
  artifactDir: string | null
): Promise<{ status: number | null; output: string }> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== SQUADRULES_LOCAL_ARTIFACT_DIR_ENV) env[key] = value;
  }
  if (artifactDir !== null) env[SQUADRULES_LOCAL_ARTIFACT_DIR_ENV] = artifactDir;
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], { env });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('close', (status) => resolve({ status, output }));
  });
}

describe('buildArtifactMaterializeInstruction shape', () => {
  it('emits the transport-neutral url method for a file:// cache path', () => {
    const { url } = writeFileSource();
    const instruction = buildArtifactMaterializeInstruction({ url, relativePath: RELATIVE_PATH, sha256: ARTIFACT_SHA });
    expect(instruction.method).toBe('url');
    expect(instruction.url).toBe(url);
    expect(instruction.out).toBe(OUT_REF);
    expect(instruction.sha256).toBe(ARTIFACT_SHA);
    expect(instruction.chmod).toBe('700');
    expect(typeof instruction.cmd).toBe('string');
  });

  it('emits the identical shape for an http capability URL', () => {
    const url = 'http://127.0.0.1:8000/export/artifact/token.value';
    const instruction = buildArtifactMaterializeInstruction({ url, relativePath: RELATIVE_PATH, sha256: ARTIFACT_SHA });
    expect(instruction.method).toBe('url');
    expect(instruction.url).toBe(url);
    expect(instruction.out).toBe(OUT_REF);
    expect(instruction.chmod).toBe('700');
    expect(instruction.cmd).toContain(`curl -fsS -o "$staging" ${shellSingleQuote(url)}`);
  });

  it('lowercases a mixed-case sha256 in both the field and the command', () => {
    const upper = ARTIFACT_SHA.toUpperCase();
    const { url } = writeFileSource();
    const instruction = buildArtifactMaterializeInstruction({ url, relativePath: RELATIVE_PATH, sha256: upper });
    expect(instruction.sha256).toBe(ARTIFACT_SHA);
    expect(instruction.cmd).toContain(`[ "$digest" = '${ARTIFACT_SHA}' ]`);
  });

  it('downloads, verifies with a portable digest chain, chmods, then publishes atomically', () => {
    const cmd = fileInstruction().cmd;
    expect(cmd).toContain(`out="$dir/${RELATIVE_PATH}"`);
    expect(cmd).toContain('mkdir -p "$parent"');
    expect(cmd).toContain('curl -fsS -o "$staging"');
    // Portable digest chain: no single platform tool is assumed.
    expect(cmd).toContain('sha256sum "$staging"');
    expect(cmd).toContain('shasum -a 256 "$staging"');
    expect(cmd).toContain('openssl dgst -sha256 "$staging"');
    expect(cmd).toContain(`[ "$digest" = '${ARTIFACT_SHA}' ]`);
    expect(cmd).toContain('chmod 700 "$staging"');
    expect(cmd).toContain('mv -f "$staging" "$out"');
  });

  it('carries no base64 decode, no export-tool call, and no sha256sum -c', () => {
    const cmd = fileInstruction().cmd;
    expect(cmd).not.toContain('base64');
    expect(cmd).not.toContain('$B64');
    expect(cmd).not.toContain('sha256sum -c');
    expect(cmd).not.toContain('inline_base64');
  });

  it('rejects a symlinked root, every ancestor, and the destination before writing', () => {
    const cmd = fileInstruction().cmd;
    expect(cmd).toContain('[ ! -L "$dir" ]');
    expect(cmd).toContain('[ ! -L "$dir/artifacts" ]');
    expect(cmd).toContain(`[ ! -L "$dir/${RELATIVE_PATH}" ]`);
    expect(cmd).toContain('resolved destination escapes the artifact root');
  });

  it('single-quotes an adversarial URL so it reaches curl literally, unexpanded', () => {
    const url = "http://127.0.0.1/x?a='$(touch /tmp/pwn)'&b=`id`";
    const instruction = buildArtifactMaterializeInstruction({ url, relativePath: RELATIVE_PATH, sha256: ARTIFACT_SHA });
    expect(instruction.cmd).toContain(shellSingleQuote(url));
    expect(instruction.cmd).toContain(`curl -fsS -o "$staging" ${shellSingleQuote(url)}`);
    // The escape sequence that closes/reopens the single-quoted run must be present.
    expect(shellSingleQuote(url)).toContain(`'\\''`);
  });
});

describe('buildArtifactMaterializeInstruction rejects unsafe input', () => {
  it('refuses a URL scheme that is not http(s) or file', () => {
    for (const url of ['squadrules://artifact/x', 'ftp://host/x', 'data:text/plain,hello', '/local/abs/path']) {
      expect(() =>
        buildArtifactMaterializeInstruction({ url, relativePath: RELATIVE_PATH, sha256: ARTIFACT_SHA })
      ).toThrow(/scheme/);
    }
  });

  it('refuses an invalid sha256', () => {
    const { url } = writeFileSource();
    for (const sha256 of ['nope', 'g'.repeat(64), 'a'.repeat(63), '']) {
      expect(() =>
        buildArtifactMaterializeInstruction({ url, relativePath: RELATIVE_PATH, sha256 })
      ).toThrow(/SHA-256/);
    }
  });

  it('refuses an unsafe destination relative_path instead of substituting a default', () => {
    const { url } = writeFileSource();
    const unsafe = [
      '../etc/passwd',
      '/abs/path.py',
      'artifacts/x$(rm -rf ~).py',
      'artifacts/x`id`.py',
      'artifacts/quo"te.py',
      "artifacts/quo'te.py",
      'artifacts/new\nline.py',
      'artifacts/back\\slash.py',
      'a/./b'
    ];
    for (const relativePath of unsafe) {
      expect(() =>
        buildArtifactMaterializeInstruction({ url, relativePath, sha256: ARTIFACT_SHA })
      ).toThrow(/relative_path/);
    }
  });
});

describe('shellSingleQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellSingleQuote('abc')).toBe(`'abc'`);
  });

  it(`escapes an embedded single quote as the four-character '\\'' run`, () => {
    expect(shellSingleQuote(`a'b`)).toBe(`'a'\\''b'`);
  });

  it('leaves shell metacharacters literal inside the quotes', () => {
    const raw = '$x`y\\z w';
    expect(shellSingleQuote(raw)).toBe(`'${raw}'`);
  });
});

describe('materialize cmd executed as emitted', () => {
  it('lands the exact bytes from a file:// source with mode 700', async () => {
    const dir = newArtifactDir();
    const run = await runMaterialize(fileInstruction().cmd, dir);
    const dest = path.join(dir, RELATIVE_PATH);

    expect(run.status).toBe(0);
    expect(fs.readFileSync(dest).equals(ARTIFACT_BYTES)).toBe(true);
    expect(fs.statSync(dest).mode & 0o777).toBe(0o700);
    expect(stagingLeftovers(dir)).toEqual([]);
  });

  it('lands the exact bytes from an http listener with mode 700', async () => {
    const dir = newArtifactDir();
    const server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/x-python');
      res.end(ARTIFACT_BYTES);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/export/artifact/token.value`;
    const instruction = buildArtifactMaterializeInstruction({ url, relativePath: RELATIVE_PATH, sha256: ARTIFACT_SHA });
    try {
      const run = await runMaterialize(instruction.cmd, dir);
      const dest = path.join(dir, RELATIVE_PATH);
      expect(run.status).toBe(0);
      expect(fs.readFileSync(dest).equals(ARTIFACT_BYTES)).toBe(true);
      expect(fs.statSync(dest).mode & 0o777).toBe(0o700);
      expect(stagingLeftovers(dir)).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('handles a destination relative_path containing spaces', async () => {
    const dir = newArtifactDir();
    const { url } = writeFileSource();
    const instruction = buildArtifactMaterializeInstruction({
      url,
      relativePath: 'my dir/gate script.py',
      sha256: ARTIFACT_SHA
    });
    const run = await runMaterialize(instruction.cmd, dir);

    expect(run.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'my dir/gate script.py')).equals(ARTIFACT_BYTES)).toBe(true);
  });

  it('fails closed on a digest mismatch, writing no destination and leaving no staging', async () => {
    const dir = newArtifactDir();
    const run = await runMaterialize(fileInstruction('b'.repeat(64)).cmd, dir);
    const dest = path.join(dir, RELATIVE_PATH);

    expect(run.status).not.toBe(0);
    expect(fs.existsSync(dest)).toBe(false);
    expect(stagingLeftovers(dir)).toEqual([]);
  });

  it('preserves a prior destination when verification fails (atomic publish)', async () => {
    const dir = newArtifactDir();
    const dest = path.join(dir, RELATIVE_PATH);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'PRE-EXISTING');
    const run = await runMaterialize(fileInstruction('b'.repeat(64)).cmd, dir);

    expect(run.status).not.toBe(0);
    expect(fs.readFileSync(dest, 'utf8')).toBe('PRE-EXISTING');
    expect(stagingLeftovers(dir)).toEqual([]);
  });

  it('fails closed when SQUADRULES_LOCAL_ARTIFACT_DIR is unset', async () => {
    const run = await runMaterialize(fileInstruction().cmd, null);
    expect(run.status).not.toBe(0);
    expect(run.output).toContain(SQUADRULES_LOCAL_ARTIFACT_DIR_ENV);
  });

  it('fails closed when SQUADRULES_LOCAL_ARTIFACT_DIR is empty', async () => {
    const run = await runMaterialize(fileInstruction().cmd, '');
    expect(run.status).not.toBe(0);
  });

  it('fails closed when SQUADRULES_LOCAL_ARTIFACT_DIR is relative', async () => {
    const run = await runMaterialize(fileInstruction().cmd, 'relative-artifact-dir');
    expect(run.status).not.toBe(0);
    expect(run.output).toContain('must be an absolute path');
  });

  it('fails closed and writes nothing outside the root when the destination is a symlink', async () => {
    const dir = newArtifactDir();
    const outside = newArtifactDir();
    fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, RELATIVE_PATH));
    const run = await runMaterialize(fileInstruction().cmd, dir);

    expect(run.status).not.toBe(0);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});
