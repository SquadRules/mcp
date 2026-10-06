import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { load } from 'js-yaml';

test('PostgreSQL 18 uses its supported parent-directory volume mount', () => {
  const compose = load(readFileSync('compose/infra.yaml', 'utf8'));
  const postgres = compose.services?.postgres;

  assert.match(postgres?.image ?? '', /^postgres:18(?:\.|-)/);
  assert.ok(postgres?.volumes?.includes('postgres-data:/var/lib/postgresql'));
  assert.ok(!postgres?.volumes?.includes('postgres-data:/var/lib/postgresql/data'));
});
