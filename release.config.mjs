/** npm-only releases; semantic-release owns versions, tags and publication. */
export const commitOptions = {
  preset: 'conventionalcommits',
  releaseRules: [
    { type: 'chore', scope: 'deps', release: 'patch' },
    { type: 'chore', scope: 'deps-dev', release: 'patch' },
    { type: 'deps', release: 'patch' },
  ],
};

export const releaseGitAssets = [
  'package.json',
  'package-lock.json',
  'compose.yaml',
  '.agents/skills/**/SKILL.md',
  '.agents/skills/**/references/SQUADRULES.md',
  'src/embed-docs/mem/*.md',
  'src/resources/embedded-mcp-resources.ts',
];

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
    ['@semantic-release/git', {
      assets: releaseGitAssets,
      message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
    }],
    // semantic-release computes gitHead before prepare; retarget the tag to the
    // release commit that @semantic-release/git just created.
    './scripts/semantic-release-source-head.mjs',
    ['@semantic-release/github', {
      assets: ['artifacts/*.tgz', 'artifacts/npm-sbom.json'],
      successComment: false,
      failComment: false,
      failTitle: false,
      releasedLabels: false,
    }],
  ],
};
