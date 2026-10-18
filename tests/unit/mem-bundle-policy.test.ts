/**
 * Bundle-wide self-compliance gate for the system-distributed mem adapters.
 *
 * The files under `src/embed-docs/mem/` are the elite examples every model
 * learns from, so they must obey the contract-verification policy they teach:
 *   - No adapter bakes in the removed `mcp` contract type or a default
 *     `user_input` human gate (bundle-wide regression guard).
 *   - Knowledge-only docs carry exactly one `comment` ACK and no other contract
 *     type (all examples are indented out of the line-start parser).
 *   - Executable adapters use only the operative types (shell / subagent / comment);
 *     a `comment` is legitimate at genuinely reasoning-only steps. Any adapter that
 *     performs writes (train / tune) must carry at least one objective `shell` gate
 *     guarding the mutation — read-only adapters are exempt from that floor.
 *   - `README.md` is not an adapter and is excluded from the scan.
 *
 * Uses the real parser (`findAllLayerContractBlocks`) — a `^\{"contract"` grep
 * misses multiline blocks, so only the parser gives the true per-layer count.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findAllLayerContractBlocks } from '../../src/services/memory/adapter-contract-blocks.js';

const MEM_DIR = join(process.cwd(), 'src', 'embed-docs', 'mem');

/** Knowledge-only docs: exactly one comment ACK, nothing else. */
const KNOWLEDGE_DOCS = [
  'challenge-type-guide',
  'contract-rationale',
  'critic-loop-guide',
  'protocol-linking-guide',
  'skill-format-guide'
];

/** Executable adapters: operative types only; writes gated by >=1 shell check. */
const EXECUTABLE_ADAPTERS = [
  'author-adapter',
  'critic-loop',
  'refine-search'
];

/** Executable adapters that mutate the store — must gate the change with a shell check. */
const WRITE_ADAPTERS = new Set(['author-adapter', 'critic-loop']);

function contractTypes(slug: string): string[] {
  const content = readFileSync(join(MEM_DIR, `${slug}.md`), 'utf8');
  return findAllLayerContractBlocks(content).map((b) => String(b.contract.type));
}

function allSlugs(): string[] {
  return readdirSync(MEM_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''));
}

describe('mem bundle self-compliance policy', () => {
  test('scanned set is exactly the knowledge docs + executable adapters', () => {
    expect([...allSlugs()].sort()).toEqual([...KNOWLEDGE_DOCS, ...EXECUTABLE_ADAPTERS].sort());
  });

  test('no adapter in the bundle uses the removed mcp contract type', () => {
    for (const slug of allSlugs()) {
      expect(contractTypes(slug)).not.toContain('mcp');
    }
  });

  test('no shipped adapter bakes in a user_input human gate', () => {
    for (const slug of allSlugs()) {
      expect(contractTypes(slug)).not.toContain('user_input');
    }
  });

  describe.each(KNOWLEDGE_DOCS)('knowledge doc %s', (slug) => {
    test('carries exactly one comment ACK and no other contract type', () => {
      const types = contractTypes(slug);
      expect(types).toEqual(['comment']);
    });
  });

  describe.each(EXECUTABLE_ADAPTERS)('executable adapter %s', (slug) => {
    test('uses only the operative contract types (no mcp / no user_input)', () => {
      const allowed = new Set(['shell', 'subagent', 'comment']);
      for (const t of contractTypes(slug)) {
        expect(allowed.has(t)).toBe(true);
      }
    });

    if (WRITE_ADAPTERS.has(slug)) {
      test('has at least one shell objective gate guarding its mutation', () => {
        expect(contractTypes(slug).filter((t) => t === 'shell').length).toBeGreaterThanOrEqual(1);
      });
    }
  });
});
