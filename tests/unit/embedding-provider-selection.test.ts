/**
 * Unit tests for embedding provider selection (issue #11 — local fastembed default).
 *
 * Covers the single selection rule that `postEmbeddings()` and
 * `EmbeddingService.getProvider()`/`getConfig()` must agree on:
 *   explicit EMBEDDING_PROVIDER -> OpenAI (incl. Ollama) -> TEI -> fastembed default.
 *
 * The fastembed path is exercised with a mocked `fastembed` module so the
 * key-free probe is proven end-to-end without a real model download.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const EMBEDDING_ENV_KEYS = [
  'EMBEDDING_PROVIDER',
  'OPENAI_API_KEY',
  'OPENAI_EMBEDDING_MODEL',
  'OPENAI_API_URL',
  'TEI_BASE_URL',
  'TEI_MODEL',
  'TEI_API_KEY',
  'FASTEMBED_MODEL',
  'FASTEMBED_CACHE_DIR',
] as const;

type EnvMap = Partial<Record<(typeof EMBEDDING_ENV_KEYS)[number], string>>;

const savedEnv: Record<string, string | undefined> = {};

function applyEnv(overrides: EnvMap): void {
  for (const key of EMBEDDING_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
}

/** Re-import config + service so module-scope constants recompute from process.env. */
async function freshService() {
  jest.resetModules();
  return await import('../../src/services/embedding/service.js');
}

/**
 * Fresh service with the embedding dimension primed (getConfig() reads it via the
 * `embeddingDimension` getter, which throws until a probe resolves it).
 */
async function freshServiceWithDimension(dim = 384) {
  const svc = await freshService();
  const cfgMod = await import('../../src/services/embedding/config.js');
  cfgMod.setResolvedEmbeddingDimension(dim);
  return svc;
}

describe('embedding provider selection (issue #11)', () => {
  beforeEach(() => {
    for (const key of EMBEDDING_ENV_KEYS) {
      if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of EMBEDDING_ENV_KEYS) process.env[key] = savedEnv[key];
    jest.resetModules();
  });

  describe('getProvider()', () => {
    test('resolves to fastembed with zero external configuration (simple mode)', async () => {
      applyEnv({});
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('fastembed');
    });

    test('prefers OpenAI when OPENAI_API_KEY is set (additive default — no forced re-index)', async () => {
      applyEnv({ OPENAI_API_KEY: 'sk-test' });
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('openai');
    });

    test('Ollama (OpenAI client at a local URL) still resolves to openai', async () => {
      applyEnv({ OPENAI_API_KEY: 'ollama', OPENAI_API_URL: 'http://localhost:11434/v1' });
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('openai');
    });

    test('falls back to TEI when only TEI is configured', async () => {
      applyEnv({ TEI_BASE_URL: 'http://tei:8080', TEI_MODEL: 'Alibaba-NLP/gte-large-en-v1.5' });
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('tei');
    });

    test('an explicit EMBEDDING_PROVIDER wins over auto-discovery', async () => {
      applyEnv({ OPENAI_API_KEY: 'sk-test', EMBEDDING_PROVIDER: 'fastembed' });
      const { embeddingService } = await freshService();
      expect(embeddingService.getProvider()).toBe('fastembed');
    });
  });

  describe('getConfig()', () => {
    test('reports the shipped fastembed default model when FASTEMBED_MODEL is unset', async () => {
      applyEnv({});
      const { embeddingService } = await freshServiceWithDimension();
      const cfg = embeddingService.getConfig();
      expect(cfg.provider).toBe('fastembed');
      // getModelName must not leak the OpenAI model on the fastembed path.
      expect(cfg.model).toBe('fast-bge-small-en-v1.5');
      expect(cfg.apiKeyConfigured).toBe(false);
    });

    test('reports an explicit FASTEMBED_MODEL override verbatim', async () => {
      applyEnv({ FASTEMBED_MODEL: 'fast-bge-base-en-v1.5' });
      const { embeddingService } = await freshServiceWithDimension(768);
      const cfg = embeddingService.getConfig();
      expect(cfg.provider).toBe('fastembed');
      expect(cfg.model).toBe('fast-bge-base-en-v1.5');
    });

    test('reports the OpenAI model on the openai path', async () => {
      applyEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small' });
      const { embeddingService } = await freshServiceWithDimension(1536);
      const cfg = embeddingService.getConfig();
      expect(cfg.provider).toBe('openai');
      expect(cfg.model).toBe('text-embedding-3-small');
      expect(cfg.apiKeyConfigured).toBe(true);
    });
  });

  describe('probeEmbeddingDimension() with the fastembed default (key-free)', () => {
    test('resolves dimension without any API key by delegating to fastembed', async () => {
      applyEnv({});
      jest.resetModules();
      // Mock fastembed so no real model download occurs; init -> embed yields 384d.
      jest.unstable_mockModule('fastembed', () => ({
        FlagEmbedding: {
          init: jest.fn(async () => ({
            embed: async function* (texts: string[]) {
              yield texts.map(() => Array.from({ length: 384 }, (_, i) => 0.001 * i));
            },
          })),
        },
        EmbeddingModel: { BGESmallENV15: 'fast-bge-small-en-v1.5' },
      }));
      const { probeEmbeddingDimension } = await import('../../src/services/embedding/service.js');
      await expect(probeEmbeddingDimension()).resolves.toBe(384);
    });
  });
});
