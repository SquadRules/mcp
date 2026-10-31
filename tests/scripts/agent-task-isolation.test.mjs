import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../../scripts/agent-task-isolation.py', import.meta.url));

let lab;
let repo;
let brokenRepo;

function git(args, cwd = repo) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function isolation(args, env = {}) {
  return spawnSync('python3', [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, REPO_ROOT: repo, ...env },
  });
}

function value(result, key) {
  const line = result.stdout.split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : undefined;
}

function worktreePath(taskId) {
  return join(`${repo}.worktrees`, taskId);
}

before(() => {
  lab = mkdtempSync(join(tmpdir(), 'squadrules-isolation-'));
  const demo = join(lab, 'demo');
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main', join(lab, 'origin.git')]);
  execFileSync('git', ['init', '-q', '-b', 'main', demo]);
  repo = realpathSync(demo);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(['add', 'README.md']);
  git(['commit', '-qm', 'initial']);
  git(['remote', 'add', 'origin', join(lab, 'origin.git')]);
  git(['push', '-q', '-u', 'origin', 'main']);
  try {
    git(['remote', 'set-head', 'origin', '-a']);
  } catch {
    // A remote without a resolvable HEAD is fine: the script falls back to origin/main.
  }

  const broken = join(lab, 'broken');
  execFileSync('git', ['init', '-q', '-b', 'main', broken]);
  brokenRepo = realpathSync(broken);
  git(['config', 'user.email', 'test@example.com'], brokenRepo);
  git(['config', 'user.name', 'Test'], brokenRepo);
  writeFileSync(join(brokenRepo, 'README.md'), 'hello\n');
  git(['add', 'README.md'], brokenRepo);
  git(['commit', '-qm', 'initial'], brokenRepo);
  git(['remote', 'add', 'origin', join(lab, 'missing-origin.git')], brokenRepo);
});

after(() => {
  if (lab) rmSync(lab, { recursive: true, force: true });
});

test('ensure creates an isolated worktree outside the main checkout and records ownership', () => {
  const result = isolation(['ensure'], { TASK_ID: 'task-001', TASK_BRANCH: 'feature/task-001' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NEW_WORKTREE_FROM_FETCHED_BASE_OK/);
  assert.equal(value(result, 'WT'), worktreePath('task-001'));
  assert.notEqual(value(result, 'WT'), repo);

  const receipt = join(repo, '.git', 'worktrees', 'task-001', 'squadrules-task.json');
  assert.ok(existsSync(receipt), 'ownership receipt is written');
  const parsed = JSON.parse(readFileSync(receipt, 'utf8'));
  assert.equal(parsed.task_id, 'task-001');
  assert.equal(parsed.task_branch, 'feature/task-001');
  assert.equal(parsed.task_base_sha, value(result, 'TASK_BASE_SHA'));
});

test('verify proves isolation and reports the same base commit as ensure', () => {
  const ensure = isolation(['ensure'], { TASK_ID: 'task-001', TASK_BRANCH: 'feature/task-001' });
  const verify = isolation(['verify'], { TASK_ID: 'task-001', TASK_BRANCH: 'feature/task-001' });

  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /WORKTREE_ISOLATION_OK/);
  assert.equal(value(verify, 'TASK_BASE_SHA'), value(ensure, 'TASK_BASE_SHA'));
});

test('verify refuses the main checkout', () => {
  const result = isolation(['verify'], {
    TASK_ID: 'task-001',
    TASK_BRANCH: 'feature/task-001',
    WT: repo,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL: /m);
});

test('verify requires the task branch so an unrelated branch cannot pass', () => {
  const result = isolation(['verify'], { TASK_ID: 'task-no-branch', TASK_BRANCH: '' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TASK_BRANCH is not set/);
});

test('an unexpected error still prints a FAIL line and exits non-zero', () => {
  const result = isolation(['ensure'], {
    TASK_ID: `task-${'x'.repeat(300)}`,
    TASK_BRANCH: 'feature/toolong',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^FAIL: /m);
});

test('ensure refuses a protected branch', () => {
  const result = isolation(['ensure'], { TASK_ID: 'task-002', TASK_BRANCH: 'main' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /protected branch/);
});

test('ensure refuses the main checkout as the task worktree', () => {
  const head = git(['rev-parse', 'HEAD']).trim();
  const result = isolation(['ensure'], {
    TASK_ID: 'task-003',
    TASK_BRANCH: 'feature/task-003',
    WT: repo,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the main checkout/);
  assert.equal(git(['rev-parse', 'HEAD']).trim(), head);
});

test('ensure refuses a worktree path strictly inside the main checkout', () => {
  const head = git(['rev-parse', 'HEAD']).trim();
  const result = isolation(['ensure'], {
    TASK_ID: 'task-005',
    TASK_BRANCH: 'feature/task-005',
    WT: join(repo, 'nested', 'task-005'),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the main checkout/);
  assert.equal(git(['rev-parse', 'HEAD']).trim(), head);
});

test('ensure stops when the fetch fails', () => {
  const result = isolation(['ensure'], {
    REPO_ROOT: brokenRepo,
    TASK_ID: 'task-004',
    TASK_BRANCH: 'feature/task-004',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /fetch origin failed/);
});

test('ensure refuses to adopt a worktree owned by another task', () => {
  const result = isolation(['ensure'], {
    TASK_ID: 'task-other',
    TASK_BRANCH: 'feature/task-001',
    WT: worktreePath('task-001'),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /owned by task/);
});

test('a diverged branch fails hard and leaves a resumable worktree', () => {
  const wt = worktreePath('task-006');
  const started = isolation(['ensure'], { TASK_ID: 'task-006', TASK_BRANCH: 'feature/task-006' });
  assert.equal(started.status, 0, started.stderr);

  writeFileSync(join(wt, 'mine.txt'), 'mine\n');
  git(['add', 'mine.txt'], wt);
  git(['commit', '-qm', 'mine'], wt);
  git(['push', '-q', '-u', 'origin', 'feature/task-006'], wt);

  // Drop the checkout so the next ensure has to create it again: the branch
  // exists, but neither the worktree nor the receipt does.
  git(['worktree', 'remove', '--force', wt], repo);

  // The remote branch is rewritten with an unrelated commit, so the local
  // branch and the remote branch have diverged.
  const other = join(lab, 'other');
  execFileSync('git', ['clone', '-q', '-b', 'feature/task-006', join(lab, 'origin.git'), other]);
  git(['config', 'user.email', 'test@example.com'], other);
  git(['config', 'user.name', 'Test'], other);
  git(['reset', '-q', '--hard', 'HEAD~1'], other);
  writeFileSync(join(other, 'theirs.txt'), 'theirs\n');
  git(['add', 'theirs.txt'], other);
  git(['commit', '-qm', 'theirs'], other);
  git(['push', '-q', '--force', 'origin', 'feature/task-006'], other);

  const result = isolation(['ensure'], { TASK_ID: 'task-006', TASK_BRANCH: 'feature/task-006' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /fast-forward/i);

  const receipt = join(repo, '.git', 'worktrees', 'task-006', 'squadrules-task.json');
  assert.ok(existsSync(receipt), 'ownership receipt survives a failed merge');

  // The next run can still reach the task it owns instead of refusing to
  // adopt a worktree left behind by the failed merge.
  const resumed = isolation(['ensure'], { TASK_ID: 'task-006', TASK_BRANCH: 'feature/task-006' });

  assert.equal(resumed.status, 1);
  assert.match(resumed.stderr, /fast-forward/i);
  assert.doesNotMatch(resumed.stderr, /refusing to adopt/);
});

test('a continued task keeps the base commit it was branched from', () => {
  git(['commit', '-q', '--allow-empty', '-m', 'main moves on']);
  git(['push', '-q', 'origin', 'main']);

  const result = isolation(['ensure'], { TASK_ID: 'task-001', TASK_BRANCH: 'feature/task-001' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESUMED_WORKTREE_OK/);
  assert.notEqual(value(result, 'TASK_BASE_SHA'), git(['rev-parse', 'origin/main']).trim());
});
