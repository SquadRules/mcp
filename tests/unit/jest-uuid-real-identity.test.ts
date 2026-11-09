/**
 * Config regression: `uuid` must resolve to the real package in every Jest lane.
 *
 * Adapter, layer and space ids are RFC 4122 v5 digests over a fixed namespace, and the
 * graph is keyed by those ids (ADR 0042), so a lane that substitutes a `uuid` stub makes
 * unit and integration assertions describe identities production never mints. A former
 * `^uuid$` moduleNameMapper did exactly that: its v4 returned one constant and its v5
 * digested a different byte sequence than RFC 4122.
 *
 * This suite fails if the mapper returns, if the stub module comes back, or if the
 * installed `uuid` stops producing RFC 4122 digests.
 */
import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** RFC 4122 appendix B: namespace DNS (6ba7b810-9dad-11d1-80b4-00c04fd430c8). */
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
/** RFC 4122 appendix B: v5(DNS, "www.widgets.com"). */
const WIDGETS_V5 = '21f7f8de-8051-5b89-8680-0195ef798b6a';

describe('jest config: uuid identity is real', () => {
  it('mints the RFC 4122 v5 digest for this lane', () => {
    expect(uuidv5('www.widgets.com', DNS_NAMESPACE)).toBe(WIDGETS_V5);
  });

  it('mints distinct v4 ids instead of one constant', () => {
    expect(uuidv4()).not.toBe(uuidv4());
  });

  it('wires no uuid stub into the shared Jest config', () => {
    const configSource = readFileSync(resolve(REPO_ROOT, 'jest.config.js'), 'utf8');
    expect(configSource).not.toMatch(/mocks\/uuid-stub/);
    expect(existsSync(resolve(REPO_ROOT, 'tests/mocks/uuid-stub.cjs'))).toBe(false);
  });
});
