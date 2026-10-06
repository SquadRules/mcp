/** npm-only releases; semantic-release owns versions, tags and publication. */
export const commitOptions = {
  preset: 'conventionalcommits',
  releaseRules: [
    { type: 'chore', scope: 'deps', release: 'patch' },
    { type: 'chore', scope: 'deps-dev', release: 'patch' },
    { type: 'deps', release: 'patch' },
  ],
};

export default {
  branches: ['main'],
  repositoryUrl: 'https://github.com/SquadRules/mcp.git',
  plugins: [
    ['@semantic-release/commit-analyzer', commitOptions],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    // npm applies nextRelease.version and creates the release tarball first.
    ['@semantic-release/npm', { tarballDir: 'artifacts' }],
    // Persist every repo artifact derived from package.json.version before tagging.
    ['@semantic-release/exec', {
      prepareCmd: 'npm run version:sync && npm run release:verify-version -- ${nextRelease.version} && npm run test:tgz && npm sbom --omit=dev --sbom-format cyclonedx > artifacts/npm-sbom.json',
    }],
    // Commit the synchronized source, push it to main and retarget the pending
    // semantic-release tag to that release commit.
    './scripts/semantic-release-persist-source.mjs',
    ['@semantic-release/github', {
      assets: ['artifacts/*.tgz', 'artifacts/npm-sbom.json'],
      successComment: false,
      failComment: false,
      failTitle: false,
      releasedLabels: false,
    }],
  ],
};
