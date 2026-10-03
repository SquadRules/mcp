#!/usr/bin/env node
/**
 * Run a single query against Qdrant and print raw similarity scores (no quality boost).
 * Use to compare Qdrant raw scores vs. app-reported scores.
 *
 * Usage (from repo root, .env with QDRANT_* and OPENAI_*):
 *   node -r dotenv/config scripts/deploy-raw-qdrant-search.mjs "get help refining your search"
 *   npm run prod:raw-qdrant-search -- "create new SQUADRULES adapter"
 */
import 'dotenv/config';

const QDRANT_URL = (process.env.QDRANT_URL || '').replace(/\/$/, '');
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'squadrules_live';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || '';
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const OPENAI_API_URL = (process.env.OPENAI_API_URL || 'https://api.openai.com').replace(/\/$/, '');

const query = process.argv[2] || 'get help refining your search';

if (!QDRANT_URL || !QDRANT_API_KEY) {
  console.error('Missing QDRANT_URL or QDRANT_API_KEY. Set in .env or environment.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY. Embedding required for search.');
  process.exit(1);
}

async function getEmbedding(text) {
  const res = await fetch(`${OPENAI_API_URL}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI ${res.status}`);
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('OpenAI returned no embedding');
  return vec;
}

async function qdrantSearch(collection, vectorName, vector, limit = 10) {
  const url = `${QDRANT_URL}/collections/${encodeURIComponent(collection)}/points/search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': QDRANT_API_KEY,
    },
    body: JSON.stringify({
      vector: { name: vectorName, vector },
      limit,
      with_payload: true,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.status?.error || `Qdrant ${res.status}`);
  return data?.result ?? [];
}

async function main() {
  console.log('Query:', query);
  console.log('Collection:', QDRANT_COLLECTION);
  const vector = await getEmbedding(query);
  const vectorName = `vs${vector.length}`;
  const results = await qdrantSearch(QDRANT_COLLECTION, vectorName, vector, 15);
  console.log('\nRaw Qdrant scores (no quality boost):');
  console.log('─'.repeat(80));
  if (results.length === 0) {
    console.log('(no results)');
    return;
  }
  for (const r of results) {
    const payload = r.payload || {};
    const label = payload.label ?? '—';
    const adapterLabel = payload.adapter?.name ?? '—';
    const score = typeof r.score === 'number' ? r.score : '—';
    console.log(`  ${String(score).padEnd(10)}  ${String(adapterLabel).slice(0, 50).padEnd(50)}  ${String(label).slice(0, 24)}`);
  }
  console.log('─'.repeat(80));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
