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
  assert.ok(docs.jobs['regenerate-wiki'].steps.some(s => s.uses?.startsWith('actions/create-github-app-token@')), 'docs.yml must create GitHub App token');
  assert.ok(docs.jobs['regenerate-wiki'].steps.some(s => s.env?.QODER_PERSONAL_ACCESS_TOKEN), 'docs.yml must use QODER_PERSONAL_ACCESS_TOKEN');
  assert.ok(docs.jobs['regenerate-wiki'].steps.some(s => s.id === 'changes'), 'docs.yml must check for changes');
  assert.ok(docs.jobs['auto-merge'], 'docs.yml must have auto-merge job');

  // The generation step fails on every run, so the run must also capture why.
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
  // Incremental update only: the full-generation path deletes the completed wiki.
  assert.match(regenerate.run, /wiki --update/, 'Regeneration must stay incremental (--update)');
  assert.doesNotMatch(regenerate.run, /--regenerate/, 'A forced full regeneration would delete committed wiki data');
});
