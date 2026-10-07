#!/usr/bin/env node
/**
 * semantic-release prepare hook for repositories where package.json.version is
 * application state, not disposable publish metadata.
 *
 * @semantic-release/npm applies nextRelease.version before this hook runs.
 * The exec prepare hook synchronizes and verifies every version-derived source
 * file. This hook then commits exactly those changes, pushes the commit to the
 * release branch, and retargets semantic-release's pending tag to that commit.
 */

import { execFileSync } from 'node:child_process';

const ALLOWED_RELEASE_PATHS = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^compose\.yaml$/,
  /^\.agents\/skills\/[^/]+\/SKILL\.md$/,
  /^\.agents\/skills\/[^/]+\/references\/SQUADRULES\.md$/,
  /^src\/embed-docs\/mem\/[^/]+\.md$/,
  /^src\/resources\/embedded-mcp-resources\.ts$/,
];

function git(args, { cwd, env, input } = {}) {
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    input,
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  // Leading spaces are status columns in porcelain output, not padding.
  }).trimEnd();
}

function changedFiles(cwd, env) {
  const output = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd, env });
  if (!output) return [];
  return output.split('\n').map(line => line.slice(3)).map(path => {
    const rename = path.indexOf(' -> ');
    return rename === -1 ? path : path.slice(rename + 4);
  });
}

export async function prepare(_pluginConfig, context) {
  const { cwd, env, branch, nextRelease, options, logger } = context;
  const changed = changedFiles(cwd, env);
  const unexpected = changed.filter(path => !ALLOWED_RELEASE_PATHS.some(pattern => pattern.test(path)));

  if (unexpected.length > 0) {
    throw new Error(`Release prepare modified unexpected tracked files: ${unexpected.join(', ')}`);
  }
  if (changed.length === 0) {
    throw new Error('Release prepare produced no versioned source changes to persist');
  }

  git(['add', '--force', '--', ...changed], { cwd, env });
  const message = `chore(release): ${nextRelease.version} [skip ci]\n`;
  git(['commit', '-F', '-'], { cwd, env, input: message });

  const head = git(['rev-parse', 'HEAD'], { cwd, env });
  const repositoryUrl = options.repositoryUrl;
  if (!repositoryUrl) throw new Error('semantic-release repositoryUrl is unavailable');

  git(['push', repositoryUrl, `HEAD:${branch.name}`], { cwd, env });

  nextRelease.gitHead = head;
  logger?.log?.('Persisted release source and set tag target to %s', head);
}
