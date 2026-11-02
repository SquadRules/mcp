// docs.yml trigger/diagnostics contract. Extracted from
// tests/scripts/workflow-structure.test.mjs to keep per-file line counts within ESLint max-lines.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

const workflow = name => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const stepNamed = (config, job, name) => config.jobs[job].steps.find(s => s.name === name);

test('docs workflow triggers cover exactly the declared wiki scope', () => {
  const docs = workflow('docs');
  const plan = load(readFileSync('.qoder/repowiki/wiki_plan.yaml', 'utf8'));
  assert.equal(docs.name, 'Docs wiki regeneration');
  assert.equal(docs.on.schedule, undefined, 'docs.yml schedule trigger disabled to reduce CI noise');
  assert.ok('workflow_dispatch' in docs.on, 'docs.yml must support manual trigger');
  assert.deepEqual(docs.on.workflow_dispatch.inputs.mode.options, ['auto', 'regenerate']);
  assert.equal(docs.on.workflow_dispatch.inputs.mode.default, 'auto');
  assert.equal(docs.concurrency['cancel-in-progress'], false);
  assert.deepEqual(docs.on.push.branches, ['main']);
  // The trigger set and the generation input set are the same contract; drift means
  // either an ungenerated change or a wasted run.
  for (const glob of plan.scope.include) {
    assert.ok(docs.on.push.paths.includes(glob), `Declared wiki input ${glob} must trigger regeneration`);
  }
  assert.ok(docs.on.push.paths.includes('.qoder/repowiki/wiki_plan.yaml'), 'The plan file itself must trigger regeneration');
  assert.deepEqual([...docs.on.push.paths].sort(), [...plan.scope.include, '.qoder/repowiki/wiki_plan.yaml'].sort());
  // Loop safety: generated output is not an input, or a merged wiki PR retriggers itself.
  for (const path of docs.on.push.paths) {
    assert.ok(!path.startsWith('.qoder/repowiki/en/'), `Generated wiki output ${path} must not be a trigger`);
  }
  assert.ok(docs.jobs['regenerate-wiki'], 'docs.yml must have regenerate-wiki job');
  for (const job of ['regenerate-wiki', 'auto-merge']) {
    const app = docs.jobs[job].steps.find(s => s.uses?.startsWith('actions/create-github-app-token@'));
    assert.ok(app, `${job} must use the SquadRules GitHub App`);
    assert.equal(app.with['permission-contents'], 'write');
    assert.equal(app.with['permission-pull-requests'], 'write');
  }
  assert.ok(docs.jobs['regenerate-wiki'].steps.some(s => s.env?.QODER_PERSONAL_ACCESS_TOKEN), 'docs.yml must use QODER_PERSONAL_ACCESS_TOKEN');
  assert.ok(docs.jobs['regenerate-wiki'].steps.some(s => s.id === 'changes'), 'docs.yml must check for changes');
  assert.ok(docs.jobs['auto-merge'], 'docs.yml must have auto-merge job');

  // Keep diagnostics for any future Qoder authentication or generator failures.
  const diagnostics = stepNamed(docs, 'regenerate-wiki', 'Capture wiki diagnostics');
  assert.ok(diagnostics, 'docs.yml must capture wiki diagnostics before generating');
  const regenerate = stepNamed(docs, 'regenerate-wiki', 'Regenerate Qoder wiki');
  const upload = docs.jobs['regenerate-wiki'].steps.find(s => s.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(docs.jobs['regenerate-wiki'].steps.indexOf(diagnostics) < docs.jobs['regenerate-wiki'].steps.indexOf(regenerate),
    'Diagnostics must precede the step that can fail the job');
  assert.equal(upload.if, 'always()', 'The diagnostics artifact must survive a failed generation');
  assert.match(upload.with.path, /wiki-diagnostics\.log/);
  assert.match(diagnostics.run, /wiki-diagnostics\.log/);
  assert.match(diagnostics.run, /qodercli@latest wiki --help/, 'Flag semantics must be captured, not assumed');
  assert.match(diagnostics.run, /repowiki-metadata\.json/, 'The committed generation stamp must be read');
  // Auto selects incremental update for a valid main wiki and bootstrap for a
  // missing/foreign-branch wiki. Full regeneration requires explicit dispatch.
  assert.match(regenerate.run, /wiki-generation-state\.mjs mode/);
  assert.match(regenerate.run, /git clone --local --no-hardlinks/);
  assert.match(regenerate.run, /\$TEMP_ROOT\/mcp/);
  assert.match(regenerate.run, /wiki --update/);
  assert.match(regenerate.run, /wiki --regenerate/);
  assert.match(regenerate.run, /\[ "\$MODE" = bootstrap \]/);
  assert.match(regenerate.run, /wiki-generation-state\.mjs validate/);
  assert.match(regenerate.run, /rsync -a --delete/);

  const changes = stepNamed(docs, 'regenerate-wiki', 'Check for changes');
  assert.match(changes.run, /git add -A \.qoder\/repowiki\//, 'New and deleted wiki files must be staged');
  assert.match(changes.run, /git diff --cached --quiet/);

  const create = stepNamed(docs, 'regenerate-wiki', 'Create docs PR');
  assert.equal(create.id, 'create-pr');
  assert.match(create.run, /gh auth setup-git/, 'The App token must authenticate git push');
  assert.match(create.run, /gh pr create/);
  assert.doesNotMatch(create.run, /--label\b/, 'Docs PR cannot depend on optional labels');
  assert.match(create.run, /\$\{PR_URL##\*\/\}/, 'Capture the PR actually created by the App');
  assert.match(create.run, /pr_number=\$PR_NUMBER/);
  assert.match(create.run, /pr_sha=\$PR_SHA/);

  const merge = stepNamed(docs, 'auto-merge', 'Auto-merge the docs PR');
  assert.equal(merge.env.PR_NUMBER, '${{ needs.regenerate-wiki.outputs.pr_number }}');
  assert.equal(merge.env.PR_SHA, '${{ needs.regenerate-wiki.outputs.pr_sha }}');
  assert.match(merge.run, /--match-head-commit/);
  assert.doesNotMatch(merge.run, /gh pr list/, 'Never merge a guessed PR');
});
