#!/usr/bin/env node
// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(repoRoot, 'tests/test-data/mime-artifact-sample');
const contractPath = path.join(fixtureRoot, 'artifact-contract.json');
const baseUrl = (process.env.KAIROS_BASE_URL || 'http://localhost:3300').replace(/\/$/, '');

function resolveBearerToken() {
  if (process.env.AUTH_BEARER_TOKEN?.trim()) return process.env.AUTH_BEARER_TOKEN.trim();
  const envSuffix = process.env.ENV || 'dev';
  const authFile = path.join(repoRoot, `.test-auth-env.${envSuffix}.json`);
  try {
    const j = JSON.parse(readFileSync(authFile, 'utf8'));
    if (typeof j.bearerToken === 'string' && j.bearerToken.trim()) return j.bearerToken.trim();
  } catch {
    /* optional file */
  }
  return '';
}

const token = resolveBearerToken();

/** Same paths and MIME types as integration tests (`artifact-contract.json`). */
function loadArtifactContract() {
  const raw = JSON.parse(readFileSync(contractPath, 'utf8'));
  const paths = raw.artifactPaths;
  const mimeByPath = raw.mimeByPath;
  if (!Array.isArray(paths) || !mimeByPath || typeof mimeByPath !== 'object') {
    throw new Error('artifact-contract.json: expected artifactPaths array and mimeByPath object');
  }
  return paths.map((relPath) => {
    const mime = mimeByPath[relPath];
    if (typeof mime !== 'string') throw new Error(`artifact-contract.json: missing mime for ${relPath}`);
    return [relPath, mime];
  });
}

const headers = {
  ...(token ? { Authorization: `Bearer ${token}` } : {})
};

function fixture(relPath) {
  return readFileSync(path.join(fixtureRoot, relPath), 'utf8');
}

async function postJson(endpoint, payload) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`${endpoint} failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postRawTrain(markdown) {
  const res = await fetch(`${baseUrl}/api/train/raw?force=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/markdown', 'X-LLM-Model-ID': 'dev-script', ...headers },
    body: markdown
  });
  if (!res.ok) throw new Error(`/api/train/raw failed ${res.status}: ${await res.text()}`);
  return res.json();
}

function readSumsFromSkillTree(treeJson) {
  const tree = JSON.parse(treeJson);
  const skill = tree.skills?.[0];
  const sums = skill?.files?.find((f) => f.path === 'SHA256SUMS');
  return sums?.content || '';
}

function readSkillMdFromSkillTree(treeJson) {
  const tree = JSON.parse(treeJson);
  const skill = tree.skills?.[0];
  const md = skill?.files?.find((f) => f.path === 'SKILL.md');
  return typeof md?.content === 'string' ? md.content : '';
}

/** Sync fixture `SKILL.md` + `SHA256SUMS` from exported skill_tree (100% self-verify parity). */
function writeFixtureFromSkillTree(treeJson) {
  const skillMd = readSkillMdFromSkillTree(treeJson);
  const sumsBody = readSumsFromSkillTree(treeJson);
  if (!skillMd) throw new Error('skill_tree export missing SKILL.md');
  if (!sumsBody) throw new Error('skill_tree export missing SHA256SUMS');
  writeFileSync(path.join(fixtureRoot, 'SKILL.md'), skillMd, 'utf8');
  writeFileSync(path.join(fixtureRoot, 'SHA256SUMS'), sumsBody, 'utf8');
  console.log('\nWrote tests/test-data/mime-artifact-sample/SKILL.md and SHA256SUMS from export.');
}

async function main() {
  const adapterTrain = await postRawTrain(fixture('SKILL.md'));
  const adapterUri = adapterTrain.items?.[0]?.adapter_uri;
  if (!adapterUri) throw new Error('train/raw response missing adapter_uri');

  for (const [relPath, mime] of loadArtifactContract()) {
    await postJson('/api/train', {
      llm_model_id: 'dev-script',
      content: fixture(relPath),
      mime,
      artifact_name: path.basename(relPath),
      adapter_uri: adapterUri,
      relative_path: relPath
    });
  }

  const tree = await postJson('/api/export', { uri: adapterUri, format: 'skill_tree' });
  const zip = await postJson('/api/export', { uri: adapterUri, format: 'skill_zip', delivery: 'inline_base64' });

  if (process.argv.includes('--write-fixture')) {
    writeFixtureFromSkillTree(tree.content);
  }

  console.log('Adapter URI:', adapterUri);
  console.log('\n--- skill_tree SHA256SUMS ---\n');
  console.log(readSumsFromSkillTree(tree.content));
  console.log('\n--- skill_zip manifest ---\n');
  console.log(zip.skill_bundle_manifest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
