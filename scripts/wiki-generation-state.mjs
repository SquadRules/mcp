// Keep Qoder generation branch/repository identity and output validation explicit.
// The GitHub Actions workflow runs Qoder in a disposable clone; this module never
// modifies the generated wiki itself.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export const WIKI_METADATA = '.qoder/repowiki/en/meta/repowiki-metadata.json';
export const WIKI_CONTENT = '.qoder/repowiki/en/content';

export function countWikiPages(directory) {
  if (!existsSync(directory)) return 0;
  let pages = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) pages += countWikiPages(target);
    else if (entry.isFile() && entry.name.endsWith('.md')) pages++;
  }
  return pages;
}

export function readWikiState(repoRoot) {
  const path = join(repoRoot, WIKI_METADATA);
  if (!existsSync(path)) return null;
  // A corrupt existing metadata file is not an invitation to overwrite it.
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  const record = metadata?.wiki_repo ?? {};
  const identity = JSON.parse(record.extend_info || '{}');
  return {
    repoName: record.name,
    branch: identity.branch,
    language: identity.language,
    completed: record.progress_status === 'completed'
      && record.wiki_present_status === 'COMPLETED',
    itemCount: Array.isArray(metadata.wiki_items) ? metadata.wiki_items.length : 0,
    pageCount: countWikiPages(join(repoRoot, WIKI_CONTENT)),
  };
}

export function isReusableWiki(state, repoName, branch = 'main', language = 'en') {
  return Boolean(state && state.completed && state.itemCount > 0 && state.pageCount > 0
    && state.repoName === repoName && state.branch === branch
    && state.language === language);
}

export function selectWikiMode(repoRoot, requested = 'auto') {
  if (requested === 'regenerate') return 'regenerate';
  if (requested !== 'auto') throw new Error(`Unsupported wiki mode: ${requested}`);
  const existing = readWikiState(repoRoot);
  return isReusableWiki(existing, basename(repoRoot)) ? 'update' : 'bootstrap';
}

export function validateGeneratedWiki(generatedRoot, originalRoot) {
  const generated = readWikiState(generatedRoot);
  if (!isReusableWiki(generated, basename(originalRoot))) {
    throw new Error(`Qoder output is not a completed main/en wiki for ${basename(originalRoot)}: ${JSON.stringify(generated)}`);
  }
  const original = readWikiState(originalRoot);
  // A full bootstrap can legitimately reshape the catalog, but a catastrophic
  // reduction in page count must be reviewed instead of silently auto-merged.
  if (original && original.pageCount > 0
      && generated.pageCount < Math.ceil(original.pageCount * 0.6)) {
    throw new Error(`Wiki pages dropped from ${original.pageCount} to ${generated.pageCount}; refusing automatic replacement`);
  }
  return { originalPages: original?.pageCount ?? 0, generatedPages: generated.pageCount };
}

function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'mode') {
    if (!second) throw new Error('Usage: wiki-generation-state.mjs mode <repo-root> <auto|regenerate>');
    console.log(selectWikiMode(first, second));
  } else if (command === 'validate') {
    if (!second) throw new Error('Usage: wiki-generation-state.mjs validate <generated-root> <original-root>');
    console.log(JSON.stringify(validateGeneratedWiki(first, second)));
  } else {
    throw new Error('Usage: wiki-generation-state.mjs <mode|validate> ...');
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
