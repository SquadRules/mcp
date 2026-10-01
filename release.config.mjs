/** Single version authority. ci-release consumes semantic-release's dry-run result,
 * then validates and persists immutable artifacts before publishing or tagging. */
// Read the new SQUADRULES_PRERELEASE_BRANCH first, falling back to the legacy
// KAIROS_PRERELEASE_BRANCH so the release flow works during the rebrand transition
// regardless of which name the calling workflow still sets.
const prereleaseBranch = process.env.SQUADRULES_PRERELEASE_BRANCH || process.env.KAIROS_PRERELEASE_BRANCH || '';
export function prereleaseChannel(branch) {
  const slug = branch.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'pre';
  return slug === 'latest' || /^v?\d+$/.test(slug) ? `pre-${slug}` : slug;
}
const channel = prereleaseChannel(prereleaseBranch);
export const parserOpts = {
  headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
  headerCorrespondence: ['type', 'scope', 'subject'],
  breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
  noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING-CHANGE'],
};
export const releaseRules = [
  { breaking: true, release: 'major' },
  { type: 'chore', scope: 'deps', release: 'patch' },
  { type: 'chore', scope: 'deps-dev', release: 'patch' },
  { type: 'deps', release: 'patch' },
];
export default {
  branches: prereleaseBranch ? ['main', { name: prereleaseBranch, prerelease: channel, channel }] : ['main'],
  plugins: [
    ['@semantic-release/commit-analyzer', { parserOpts, releaseRules }],
    ['@semantic-release/release-notes-generator', { parserOpts }],
  ],
};
