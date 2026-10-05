/** npm-only releases; semantic-release owns versions, tags and publication. */
export const commitOptions = {
  preset: 'conventionalcommits',
  // Preserve historical dependency commit semantics used by the update bots.
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
    // npm updates the workspace version before prepack builds embedded resources.
    ['@semantic-release/npm', { tarballDir: 'artifacts' }],
    ['@semantic-release/exec', {
      prepareCmd: 'npm run test:tgz && npm sbom --omit=dev --sbom-format cyclonedx > artifacts/npm-sbom.json',
    }],
    ['@semantic-release/github', {
      assets: ['artifacts/*.tgz', 'artifacts/npm-sbom.json'],
      successComment: false,
      failComment: false,
      failTitle: false,
      releasedLabels: false,
    }],
  ],
};
