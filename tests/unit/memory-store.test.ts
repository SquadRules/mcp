/**
 * Unit tests for MemoryStore (in-memory key-value store).
 * Run with REDIS_URL unset or empty to use the memory backend without Redis.
 */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { MemoryStore } from '../../src/services/memory-store.js';
import { SQUADRULES_APP_SPACE_ID } from '../../src/config.js';
import { runWithSpaceContext } from '../../src/utils/tenant-context.js';

function withDefaultSpace<T>(fn: () => Promise<T>): Promise<T> {
  return runWithSpaceContext(
    {
      userId: '',
      groupIds: [],
      allowedSpaceIds: [SQUADRULES_APP_SPACE_ID],
      defaultWriteSpaceId: SQUADRULES_APP_SPACE_ID,
      personalSpaceId: ''
    },
    fn
  );
}

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  describe('connect / disconnect / isConnected', () => {
    test('isConnected returns true after connect', async () => {
      expect(store.isConnected()).toBe(true);
      await store.connect();
      expect(store.isConnected()).toBe(true);
    });

    test('isConnected returns false after disconnect', async () => {
      await store.disconnect();
      expect(store.isConnected()).toBe(false);
    });
  });

  describe('get / set / del', () => {
    test('set and get string', async () => {
      await withDefaultSpace(async () => {
        await store.set('k1', 'v1');
        expect(await store.get('k1')).toBe('v1');
      });
    });

    test('get missing key returns null', async () => {
      await withDefaultSpace(async () => {
        expect(await store.get('missing')).toBeNull();
      });
    });

    test('del removes key', async () => {
      await withDefaultSpace(async () => {
        await store.set('k2', 'v2');
        await store.del('k2');
        expect(await store.get('k2')).toBeNull();
      });
    });
  });

  describe('getJson / setJson', () => {
    test('set and get JSON', async () => {
      await withDefaultSpace(async () => {
        await store.setJson('j1', { a: 1, b: 'two' });
        expect(await store.getJson<{ a: number; b: string }>('j1')).toEqual({ a: 1, b: 'two' });
      });
    });
  });

  describe('hash operations', () => {
    test('hset and hget', async () => {
      await withDefaultSpace(async () => {
        await store.hset('h1', 'f1', 'v1');
        expect(await store.hget('h1', 'f1')).toBe('v1');
      });
    });

    test('hsetall and hgetall', async () => {
      await withDefaultSpace(async () => {
        await store.hsetall('h2', { x: '1', y: '2' });
        expect(await store.hgetall('h2')).toEqual({ x: '1', y: '2' });
      });
    });
  });

  describe('incr', () => {
    test('incr increments and returns new value', async () => {
      await withDefaultSpace(async () => {
        expect(await store.incr('c1')).toBe(1);
        expect(await store.incr('c1')).toBe(2);
      });
    });
  });

  describe('exists', () => {
    test('exists returns true for set key', async () => {
      await withDefaultSpace(async () => {
        await store.set('e1', 'v');
        expect(await store.exists('e1')).toBe(true);
      });
    });

    test('exists returns false for missing key', async () => {
      await withDefaultSpace(async () => {
        expect(await store.exists('missing')).toBe(false);
      });
    });
  });

  describe('keys (glob pattern)', () => {
    test('keys returns matching keys (full internal key format)', async () => {
      await withDefaultSpace(async () => {
        await store.set('search:a:1', 'v1');
        await store.set('search:b:2', 'v2');
        await store.set('other:x', 'v3');
        const keys = await store.keys('search:*');
        expect(keys.length).toBe(2);
        expect(keys.every(k => k.includes('search:'))).toBe(true);
      });
    });
  });

  describe('publish', () => {
    test('publish returns 0 (no-op)', async () => {
      await withDefaultSpace(async () => {
        expect(await store.publish('ch', 'msg')).toBe(0);
      });
    });
  });

  describe('TTL', () => {
    test('get returns null after TTL expires', async () => {
      jest.useFakeTimers();
      await withDefaultSpace(async () => {
        await store.set('ttl1', 'v', 2);
        expect(await store.get('ttl1')).toBe('v');
        jest.advanceTimersByTime(3000);
        expect(await store.get('ttl1')).toBeNull();
      });
      jest.useRealTimers();
    });
  });
});
