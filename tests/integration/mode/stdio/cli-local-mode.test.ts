/**
 * D1 — local-mode CLI coverage against the embedded store (SINGLE / stdio lane only).
 *
 * The CLI is local-by-default: with no `--url` it resolves the `stdio://local` sentinel and
 * runs each command in-process against the embedded LanceDB store via `LocalBackend`
 * (`bootLocalRuntime` fastboot). This exercises that path end to end.
 *
 * Two hard constraints shape the test:
 *  - ONNX must never run inside a Jest vm-realm worker (ADR 0004: a fastembed/ONNX
 *    `Float32Array instanceof` check throws across realms). `train`/`activate` load the
 *    embedding model, so every command is driven through a CHILD process, not in-process.
 *  - Local mode boots the runtime, and all boot logging goes to stderr (ADR 0008); stdout is
 *    reserved for the command payload. So we assert on parsed stdout, never on empty stderr.
 *
 * Skipped on the HTTP/cluster lane (`isHttpTransport()`), where there is no embedded store and
 * the CLI talks to a live server instead (see cli-commands-basic/advanced).
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { applyLocalStdioEnv } from '../../../utils/stdio-simple-env.js';
import { isHttpTransport } from '../../../utils/auth-headers.js';

const execFilePromise = promisify(execFile);

const CLI_PATH = join(process.cwd(), 'dist/cli/index.js');
const TEST_FILE = join(process.cwd(), 'tests/test-data/cli-minimal-test.md');

const _d = isHttpTransport() ? describe.skip : describe;

/**
 * Env for a local-mode CLI child: stdio/simple-mode (auth off, embedded store), key-free
 * fastembed so the embedded model is used, and boot logs kept off stdout. `XDG_CONFIG_HOME`
 * and `FASTEMBED_CACHE_DIR` are inherited from the lane so the child shares the one embedded
 * store (seeded once) and the cached model weights (ADR 0004/0007).
 */
function localCliEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    env[key] = value ?? '';
  }
  applyLocalStdioEnv(env);
  env.OPENAI_API_KEY = '';
  env.TEI_BASE_URL = '';
  env.EMBEDDING_PROVIDER = 'fastembed';
  env.LOG_LEVEL = 'error';
  env.SQUADRULES_NO_BROWSER = '1';
  return env;
}

async function runCli(
  args: string[],
  timeout: number,
  env: NodeJS.ProcessEnv = localCliEnv()
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFilePromise(process.execPath, [CLI_PATH, ...args], {
    cwd: process.cwd(),
    env,
    timeout,
    maxBuffer: 16 * 1024 * 1024
  });
  return { stdout, stderr };
}

_d('CLI local mode (embedded store, stdio lane)', () => {
  let trainedUri: string | null = null;
  let outDir = '';

  // The first command pays the cold-store cost (boot injection embeds the shipped adapters and
  // loads the model) when no earlier lane test has seeded the shared store yet; warm runs are
  // seconds. Give the seed path a generous budget.
  beforeAll(async () => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(`CLI not built: missing ${CLI_PATH}. Run \`npm run build\` first.`);
    }
    outDir = mkdtempSync(join(tmpdir(), 'squadrules-cli-local-'));
    const { stdout } = await runCli(['train', '--force', TEST_FILE, '--format', 'json'], 240000);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty('status');
    trainedUri = data.items?.[0]?.uri ?? null;
    expect(trainedUri).toBeTruthy();
  }, 300000);

  test('activate matches against the embedded store with no --url (local default)', async () => {
    const { stdout } = await runCli(['activate', 'minimal CLI test', '--format', 'json'], 120000);
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('must_obey');
    expect(result).toHaveProperty('choices');
    // B1: JSON mode emits the raw activate result verbatim — no injected `cli_next_call`.
    expect(result).not.toHaveProperty('cli_next_call');
  }, 120000);

  test('forward runs a layer against the embedded store', async () => {
    expect(trainedUri).toBeTruthy();
    const solution = JSON.stringify({ type: 'comment', comment: { text: 'local mode forward' } });
    try {
      const { stdout } = await runCli(
        ['forward', trainedUri as string, '--solution', solution, '--format', 'json'],
        120000
      );
      const result = JSON.parse(stdout);
      expect(result).toHaveProperty('must_obey');
      expect(result).toHaveProperty('next_action');
      // B1: forward JSON carries the schema-native `next_call`.
      expect(result).toHaveProperty('next_call');
    } catch (error) {
      // A freshly trained adapter may reject an ill-fitting solution at the contract layer;
      // that is still a valid local-mode round trip (mirrors cli-commands-advanced).
      const e = error as { message?: string; stderr?: string };
      expect(e.message || e.stderr || '').toMatch(/step|layer|contract|solution|invalid/i);
    }
  }, 120000);

  test('reward records a signal against the embedded store', async () => {
    expect(trainedUri).toBeTruthy();
    const { stdout } = await runCli(
      ['reward', trainedUri as string, 'success', 'local mode reward', '--format', 'json'],
      120000
    );
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('results');
    // B1: reward JSON carries the schema-native `next_call` (null).
    expect(result).toHaveProperty('next_call');
  }, 120000);

  test('spaces lists at least one space in local mode', async () => {
    const { stdout } = await runCli(['spaces', '--format', 'json'], 120000);
    const result = JSON.parse(stdout);
    expect(Array.isArray(result.spaces)).toBe(true);
    expect(result.spaces.length).toBeGreaterThan(0);
    expect(result.spaces[0]).toHaveProperty('name');
    expect(result.spaces[0]).toHaveProperty('space_id');
  }, 120000);

  test('export writes the adapter to disk and prints a machine manifest', async () => {
    expect(trainedUri).toBeTruthy();
    const { stdout } = await runCli(
      ['export', trainedUri as string, '--as', 'markdown', '--out', outDir, '--format', 'json'],
      120000
    );
    const manifest = JSON.parse(stdout);
    // B2: export never dumps content to stdout; it writes a file and reports a compact manifest.
    expect(manifest.format).toBe('markdown');
    expect(Array.isArray(manifest.written)).toBe(true);
    expect(manifest.written.length).toBe(1);
    const writtenPath = manifest.written[0].path as string;
    expect(existsSync(writtenPath)).toBe(true);
    expect(readFileSync(writtenPath, 'utf8').length).toBeGreaterThan(0);
  }, 120000);

  test('local boot logs stay on stderr; stdout is a pure JSON payload (default transport)', async () => {
    // Regression (shipped 5.5.0): a local data command is NOT a local *server* launch, so
    // TRANSPORT_TYPE resolves to `http` and the shared pino sink wrote boot INFO lines
    // (cache:/vector store:/embedding:) to STDOUT, corrupting `activate ... | jq`. The CLI
    // prelude now forces logs to stderr. Unlike the cases above (stdio transport +
    // LOG_LEVEL=error), this runs with the default transport and default log level, so it
    // reproduces exactly what a human hits with `npx @squadrules/mcp activate ...`.
    const env = localCliEnv();
    env.TRANSPORT_TYPE = 'http'; // what a data command resolves to by default
    delete env.LOG_LEVEL; // default info → boot logs are emitted
    delete env.SQUADRULES_LOG_STDERR; // the CLI prelude must set this, not the test
    const { stdout, stderr } = await runCli(['spaces', '--format', 'json'], 120000, env);
    // stdout parses as JSON with no `[HH:MM:SS] [LEVEL]` log lines interleaved.
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stdout).not.toMatch(/^\[\d{2}:\d{2}:\d{2}\]/m);
    // The boot logs went to stderr instead.
    expect(stderr).toMatch(/vector store:|cache:|embedding:|model stats:/);
  }, 120000);

  afterAll(async () => {
    // Best-effort cleanup so the shared embedded store is left as it was found.
    if (trainedUri) {
      await runCli(['delete', trainedUri, '--format', 'json'], 120000).catch(() => {});
    }
  }, 180000);
});
