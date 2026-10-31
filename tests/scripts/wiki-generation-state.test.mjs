import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  countWikiPages, isReusableWiki, readWikiState, selectWikiMode, validateGeneratedWiki,
} from '../../scripts/wiki-generation-state.mjs';

function fixture(t, folder = 'mcp') {
  const base = mkdtempSync(join(tmpdir(), 'squadrules-qoder-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, folder);
  mkdirSync(root, { recursive: true });
  return root;
}

function populate(root, { name = 'mcp', branch = 'main', language = 'en', count = 3,
  status = 'completed', present = 'COMPLETED' } = {}) {
  const pages = join(root, '.qoder/repowiki/en/content');
  const metadataDir = join(root, '.qoder/repowiki/en/meta');
  mkdirSync(pages, { recursive: true });
  mkdirSync(metadataDir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(pages, `page-${i}.md`), `# Page ${i}\n`);
  }
  writeFileSync(join(metadataDir, 'repowiki-metadata.json'), JSON.stringify({
    wiki_repo: {
      name, progress_status: status, wiki_present_status: present,
      extend_info: JSON.stringify({ branch, language }),
    },
    wiki_items: [{}],
  }));
}

test('missing wiki bootstraps instead of failing incremental update', t => {
  const root = fixture(t);
  assert.equal(readWikiState(root), null);
  assert.equal(selectWikiMode(root), 'bootstrap');
});

test('completed wiki for the current repository and branch updates incrementally', t => {
  const root = fixture(t);
  populate(root);
  assert.equal(selectWikiMode(root), 'update');
  assert.equal(readWikiState(root).pageCount, 3);
  assert.equal(countWikiPages(join(root, '.qoder/repowiki/en/content')), 3);
});

test('wiki from a renamed directory or deleted branch is bootstrapped', t => {
  const oldFolder = fixture(t);
  populate(oldFolder, { name: 'prune-agent-assets-20261013', branch: 'chore/prune-agent-assets' });
  assert.equal(selectWikiMode(oldFolder), 'bootstrap');
  assert.equal(isReusableWiki(readWikiState(oldFolder), 'mcp'), false);
});

test('incomplete wiki is bootstrapped and corrupt metadata fails closed', t => {
  const root = fixture(t);
  populate(root, { status: 'failed' });
  assert.equal(selectWikiMode(root), 'bootstrap');
  writeFileSync(join(root, '.qoder/repowiki/en/meta/repowiki-metadata.json'), '{invalid');
  assert.throws(() => selectWikiMode(root), SyntaxError);
});

test('regenerate is explicit; unsupported modes fail', t => {
  const root = fixture(t);
  populate(root);
  assert.equal(selectWikiMode(root, 'regenerate'), 'regenerate');
  assert.throws(() => selectWikiMode(root, 'delete'), /Unsupported wiki mode/);
});

test('generated wiki must have a complete main/en identity', t => {
  const original = fixture(t);
  const generated = fixture(t);
  populate(original, { branch: 'chore/prune-agent-assets' });
  populate(generated, { branch: 'other-branch' });
  assert.throws(() => validateGeneratedWiki(generated, original), /not a completed main\/en wiki/);
});

test('valid bootstrap from old branch retains pages and is safe', t => {
  const original = fixture(t);
  const generated = fixture(t);
  populate(original, { name: 'prune-agent-assets-20261013', branch: 'chore/prune-agent-assets' });
  populate(generated, { count: 3 });
  assert.deepEqual(validateGeneratedWiki(generated, original),
    { originalPages: 3, generatedPages: 3 });
});

test('catastrophic page loss is blocked even when Qoder reports completion', t => {
  const original = fixture(t);
  const generated = fixture(t);
  populate(original, { count: 10 });
  populate(generated, { count: 2 });
  assert.throws(() => validateGeneratedWiki(generated, original), /Wiki pages dropped/);
});
