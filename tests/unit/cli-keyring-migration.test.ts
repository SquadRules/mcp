/**
 * Keyring service-name migration (kairos-cli -> squadrules-cli).
 *
 * Guarantees under test:
 *  1. Reads prefer the new service; when absent they fall back to the prior service and
 *     transparently copy forward (copy, not move — the prior entry is retained).
 *  2. A failed copy-write never breaks the user: the prior value is still returned.
 *  3. Writes go to the new service only.
 *  4. Deletes remove the credential from BOTH services (logout cleanup).
 *  5. Access + refresh tokens both migrate.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  __setKeyringForTest,
  getToken,
  setToken,
  deleteToken,
  getRefreshToken,
  setRefreshToken,
  deleteRefreshToken,
  KEYRING_SERVICE,
  KEYRING_SERVICE_PRIOR,
} from '../../src/cli/keyring.js';

const REFRESH_SUFFIX = '::refresh';
const ACCOUNT = 'http://localhost:3300';

type Store = Record<string, string>;
const key = (service: string, account: string): string => `${service}\u0000${account}`;

interface FakeKeyring {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
  writes: string[];
  deletes: string[];
}

function makeFakeKeyring(store: Store, opts: { failWrites?: boolean } = {}): FakeKeyring {
  const writes: string[] = [];
  const deletes: string[] = [];
  return {
    writes,
    deletes,
    getPassword: async (service, account) => store[key(service, account)] ?? null,
    setPassword: async (service, account, password) => {
      if (opts.failWrites) throw new Error('keychain write denied');
      store[key(service, account)] = password;
      writes.push(key(service, account));
    },
    deletePassword: async (service, account) => {
      const k = key(service, account);
      deletes.push(k);
      const had = k in store;
      delete store[k];
      return had;
    },
  };
}

afterEach(() => {
  __setKeyringForTest(null);
});

describe('keyring migration: reads', () => {
  it('returns the token from the new service when present', async () => {
    const store: Store = { [key(KEYRING_SERVICE, ACCOUNT)]: 'new-token' };
    const fake = makeFakeKeyring(store);
    __setKeyringForTest(fake as never);

    expect(await getToken(ACCOUNT)).toBe('new-token');
    // No prior-service copy needed.
    expect(fake.writes).toHaveLength(0);
  });

  it('falls back to the prior service and copies forward (retaining the prior entry)', async () => {
    const store: Store = { [key(KEYRING_SERVICE_PRIOR, ACCOUNT)]: 'prior-token' };
    const fake = makeFakeKeyring(store);
    __setKeyringForTest(fake as never);

    expect(await getToken(ACCOUNT)).toBe('prior-token');
    // Copied to the new service...
    expect(store[key(KEYRING_SERVICE, ACCOUNT)]).toBe('prior-token');
    expect(fake.writes).toContain(key(KEYRING_SERVICE, ACCOUNT));
    // ...and the prior entry is NOT deleted (rollback window).
    expect(store[key(KEYRING_SERVICE_PRIOR, ACCOUNT)]).toBe('prior-token');
    expect(fake.deletes).toHaveLength(0);
  });

  it('still returns the prior token when the copy-write fails', async () => {
    const store: Store = { [key(KEYRING_SERVICE_PRIOR, ACCOUNT)]: 'prior-token' };
    const fake = makeFakeKeyring(store, { failWrites: true });
    __setKeyringForTest(fake as never);

    // User is not broken by a failed migration write.
    expect(await getToken(ACCOUNT)).toBe('prior-token');
    // Nothing landed in the new service.
    expect(store[key(KEYRING_SERVICE, ACCOUNT)]).toBeUndefined();
  });

  it('returns null when neither service has the token', async () => {
    const fake = makeFakeKeyring({});
    __setKeyringForTest(fake as never);
    expect(await getToken(ACCOUNT)).toBeNull();
  });
});

describe('keyring migration: refresh tokens', () => {
  it('falls back to the prior refresh token and copies forward', async () => {
    const store: Store = {
      [key(KEYRING_SERVICE_PRIOR, ACCOUNT + REFRESH_SUFFIX)]: 'prior-refresh',
    };
    const fake = makeFakeKeyring(store);
    __setKeyringForTest(fake as never);

    expect(await getRefreshToken(ACCOUNT)).toBe('prior-refresh');
    expect(store[key(KEYRING_SERVICE, ACCOUNT + REFRESH_SUFFIX)]).toBe('prior-refresh');
    // Prior entry retained.
    expect(store[key(KEYRING_SERVICE_PRIOR, ACCOUNT + REFRESH_SUFFIX)]).toBe('prior-refresh');
  });

  it('returns the prior refresh token when copy-write fails', async () => {
    const store: Store = {
      [key(KEYRING_SERVICE_PRIOR, ACCOUNT + REFRESH_SUFFIX)]: 'prior-refresh',
    };
    const fake = makeFakeKeyring(store, { failWrites: true });
    __setKeyringForTest(fake as never);

    expect(await getRefreshToken(ACCOUNT)).toBe('prior-refresh');
  });
});

describe('keyring migration: writes go to the new service only', () => {
  it('setToken writes only to the new service', async () => {
    const fake = makeFakeKeyring({});
    __setKeyringForTest(fake as never);

    expect(await setToken(ACCOUNT, 'fresh-token')).toBe(true);
    expect(fake.writes).toEqual([key(KEYRING_SERVICE, ACCOUNT)]);
  });

  it('setRefreshToken writes only to the new service', async () => {
    const fake = makeFakeKeyring({});
    __setKeyringForTest(fake as never);

    expect(await setRefreshToken(ACCOUNT, 'fresh-refresh')).toBe(true);
    expect(fake.writes).toEqual([key(KEYRING_SERVICE, ACCOUNT + REFRESH_SUFFIX)]);
  });

  it('setToken reports false when the write fails', async () => {
    const fake = makeFakeKeyring({}, { failWrites: true });
    __setKeyringForTest(fake as never);
    expect(await setToken(ACCOUNT, 'tok')).toBe(false);
  });
});

describe('keyring migration: deletes clean up both services', () => {
  it('deleteToken removes from the new and prior services', async () => {
    const store: Store = {
      [key(KEYRING_SERVICE, ACCOUNT)]: 'new-token',
      [key(KEYRING_SERVICE_PRIOR, ACCOUNT)]: 'prior-token',
    };
    const fake = makeFakeKeyring(store);
    __setKeyringForTest(fake as never);

    expect(await deleteToken(ACCOUNT)).toBe(true);
    expect(store[key(KEYRING_SERVICE, ACCOUNT)]).toBeUndefined();
    expect(store[key(KEYRING_SERVICE_PRIOR, ACCOUNT)]).toBeUndefined();
    expect(fake.deletes).toContain(key(KEYRING_SERVICE, ACCOUNT));
    expect(fake.deletes).toContain(key(KEYRING_SERVICE_PRIOR, ACCOUNT));
  });

  it('deleteRefreshToken removes from the new and prior services', async () => {
    const store: Store = {
      [key(KEYRING_SERVICE, ACCOUNT + REFRESH_SUFFIX)]: 'new-refresh',
      [key(KEYRING_SERVICE_PRIOR, ACCOUNT + REFRESH_SUFFIX)]: 'prior-refresh',
    };
    const fake = makeFakeKeyring(store);
    __setKeyringForTest(fake as never);

    expect(await deleteRefreshToken(ACCOUNT)).toBe(true);
    expect(store[key(KEYRING_SERVICE, ACCOUNT + REFRESH_SUFFIX)]).toBeUndefined();
    expect(store[key(KEYRING_SERVICE_PRIOR, ACCOUNT + REFRESH_SUFFIX)]).toBeUndefined();
  });
});
