#!/usr/bin/env node
/**
 * semantic-release prepare hook: after @semantic-release/git has created and
 * pushed the versioned source commit, retarget semantic-release's pending tag
 * to that commit instead of the pre-prepare event SHA.
 */

import { execFileSync } from 'node:child_process';

export function currentGitHead(cwd, env = process.env) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    env,
    encoding: 'utf8',
  }).trim();
}

export async function prepare(_pluginConfig, context) {
  const head = currentGitHead(context.cwd, context.env);
  context.nextRelease.gitHead = head;
  context.logger?.log?.('Release tag target set to persisted source commit %s', head);
}
