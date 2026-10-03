// squadrules-compat-surface: references Keycloak realm/client or keyring service names (kairos-dev / kairos-prod / kairos-cli) provisioned in existing deployments
/**
 * CLI keyring: OS-native credential storage for bearer tokens.
 * Uses @napi-rs/keyring (keytar-compatible API). When keyring is unavailable or
 * fails at runtime, the CLI falls back to the config file at XDG_CONFIG_HOME/squadrules
 * (or ~/.config/squadrules on Unix, %APPDATA%\\squadrules on Windows) for all users.
 *
 * Migration: credentials stored under the prior service name (`kairos-cli`) are
 * transparently copied to the new service name (`squadrules-cli`) on first read.
 * Prior entries are never deleted during reads — only on explicit logout/delete.
 */

import { createRequire } from 'module';

const requireMod = createRequire(import.meta.url);

/** Primary keyring service name (post-rebrand). */
export const KEYRING_SERVICE = 'squadrules-cli';
/** Prior keyring service name (pre-rebrand). Retained for fallback reads and cleanup on delete. */
export const KEYRING_SERVICE_PRIOR = 'kairos-cli';

/** Distinct keyring account suffix for refresh tokens (normalized API URL + suffix). */
const REFRESH_ACCOUNT_SUFFIX = '::refresh';

function refreshAccount(account: string): string {
    return `${account}${REFRESH_ACCOUNT_SUFFIX}`;
}

/**
 * Read from the new service; if absent, fall back to the prior service and copy forward.
 * Returns the credential value or null. Never throws.
 *
 * The copy is best-effort: if writing to the new service fails (e.g. keyring
 * locked), the value from the prior service is still returned so the user is not disrupted.
 */
async function readWithPriorFallback(
    mod: KeytarModule,
    account: string,
): Promise<string | null> {
    // 1. Try new service
    const primary = await runKeyringOp(mod.getPassword(KEYRING_SERVICE, account));
    if (primary !== KEYRING_TIMED_OUT && primary !== null) return primary;
    if (primary === KEYRING_TIMED_OUT) return null;

    // 2. Fallback to the prior service
    const prior = await runKeyringOp(mod.getPassword(KEYRING_SERVICE_PRIOR, account));
    if (prior === KEYRING_TIMED_OUT || prior === null) return null;

    // 3. Copy to new service (best-effort; never delete the prior entry here)
    try {
        await runKeyringOp(mod.setPassword(KEYRING_SERVICE, account, prior));
        // Verify the write succeeded by reading back
        const verify = await runKeyringOp(mod.getPassword(KEYRING_SERVICE, account));
        if (verify === KEYRING_TIMED_OUT || verify !== prior) {
            // Verification failed — still return the prior value, don't break the user
        }
    } catch {
        // Copy failed — still return the prior value
    }

    return prior;
}

/**
 * Delete from both the new and prior services. Used on logout/cleanup.
 * Returns true if the new-service deletion succeeded (or was absent).
 */
async function deleteFromBothServices(
    mod: KeytarModule,
    account: string,
): Promise<boolean> {
    let primaryOk = false;
    try {
        const r = await runKeyringOp(mod.deletePassword(KEYRING_SERVICE, account));
        primaryOk = r !== KEYRING_TIMED_OUT;
    } catch {
        primaryOk = false;
    }
    // Best-effort prior-service cleanup
    try {
        await runKeyringOp(mod.deletePassword(KEYRING_SERVICE_PRIOR, account));
    } catch {
        // Prior-service deletion failure is non-fatal
    }
    return primaryOk;
}

type KeytarModule = {
    getPassword: (service: string, account: string) => Promise<string | null>;
    setPassword: (service: string, account: string, password: string) => Promise<void>;
    deletePassword: (service: string, account: string) => Promise<boolean>;
};

/** Timeout for keyring operations. macOS Keychain can hang indefinitely if locked or unresponsive. */
const KEYRING_TIMEOUT_MS = 10_000;

/**
 * Race a keyring promise against a timeout. Returns the fallback on timeout instead of hanging.
 * The timer is cleared once the race settles and is unref'd so it never keeps the CLI process
 * alive on its own — otherwise a resolved keyring op would still block exit until the timer fires.
 *
 * Exported for unit testing of the no-leak contract; not part of the public keyring API.
 */
export function withKeyringTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), KEYRING_TIMEOUT_MS);
        timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

let keytar: KeytarModule | null | undefined = undefined;
/** Captured error from the last failed require of the native keyring binding (null if load succeeded). */
let keyringLoadError: Error | null = null;
/**
 * Degradation latch: set once any keyring operation times out. macOS Keychain can hang
 * indefinitely with no answerable authorization prompt; without this latch every subsequent op
 * would re-incur the full KEYRING_TIMEOUT_MS stall (readConfig runs several ops, and
 * ApiClient.request calls readConfig multiple times — tens of seconds of hang). Once latched, ops
 * short-circuit to the config-file fallback immediately.
 */
let keyringDegraded = false;

/** Sentinel distinguishing a timed-out keyring op from a legitimate null/absent value. */
const KEYRING_TIMED_OUT = Symbol('keyring-timed-out');

function loadKeyring(): KeytarModule | null {
    if (keytar !== undefined) return keytar;
    try {
        const mod = requireMod('@napi-rs/keyring/keytar') as KeytarModule;
        keytar = mod;
        return mod;
    } catch (err) {
        keytar = null;
        keyringLoadError = err instanceof Error ? err : new Error(String(err));
        return null;
    }
}

/**
 * Run a keyring operation under the shared timeout. On timeout, latch degradation and return the
 * sentinel so callers can distinguish "timed out" from a real result.
 */
async function runKeyringOp<T>(op: Promise<T>): Promise<T | typeof KEYRING_TIMED_OUT> {
    const result = await withKeyringTimeout<T | typeof KEYRING_TIMED_OUT>(op, KEYRING_TIMED_OUT);
    if (result === KEYRING_TIMED_OUT) keyringDegraded = true;
    return result;
}

/**
 * Whether the keyring backend is usable: the native module loaded AND it has not degraded (a prior
 * operation did not time out). Returns false once degraded so callers fall back to the config file
 * instead of stalling on every op.
 */
export function isKeyringAvailable(): boolean {
    return loadKeyring() !== null && !keyringDegraded;
}

/** The error captured when the native keyring binding failed to load, or null if it loaded. */
export function getKeyringLoadError(): Error | null {
    loadKeyring();
    return keyringLoadError;
}

/**
 * Human-readable reason the keyring is unavailable, or null when it is usable. Distinguishes a
 * missing/broken native binding from a keychain that loaded but stopped responding (timed out).
 */
export function getKeyringUnavailableReason(): string | null {
    if (loadKeyring() === null) {
        const detail = keyringLoadError?.message ?? 'unknown error';
        return `native keyring binding unavailable (${detail})`;
    }
    if (keyringDegraded) {
        return `keychain did not respond (timed out after ${KEYRING_TIMEOUT_MS / 1000}s)`;
    }
    return null;
}

/** Test-only: inject a fake keyring module (or null) and reset the degradation latch. */
export function __setKeyringForTest(mod: KeytarModule | null, loadError: Error | null = null): void {
    keytar = mod;
    keyringLoadError = loadError;
    keyringDegraded = false;
}

/**
 * Get the stored bearer token for the given account (normalized API URL).
 * Tries new service first, then the prior service with transparent copy-forward.
 * Returns null if not found or keyring unavailable.
 */
export async function getToken(account: string): Promise<string | null> {
    const mod = loadKeyring();
    if (!mod || keyringDegraded) return null;
    try {
        return await readWithPriorFallback(mod, account);
    } catch {
        return null;
    }
}

/**
 * Store the bearer token for the given account in the new service.
 * Returns true if stored in keyring, false if keyring unavailable or setPassword threw
 * (config-file will fall back to file).
 */
export async function setToken(account: string, token: string): Promise<boolean> {
    const mod = loadKeyring();
    if (!mod || keyringDegraded) return false;
    try {
        const result = await runKeyringOp(mod.setPassword(KEYRING_SERVICE, account, token));
        return result !== KEYRING_TIMED_OUT;
    } catch {
        return false;
    }
}

/**
 * Delete the stored bearer token for the given account from BOTH the new and prior services.
 * Returns true if deleted from new service (or not present), false if keyring unavailable.
 */
export async function deleteToken(account: string): Promise<boolean> {
    const mod = loadKeyring();
    if (!mod || keyringDegraded) return false;
    try {
        return await deleteFromBothServices(mod, account);
    } catch {
        return false;
    }
}

/**
 * Get the stored refresh token. Tries new service first, then the prior service with transparent copy-forward.
 */
export async function getRefreshToken(account: string): Promise<string | null> {
    const mod = loadKeyring();
    if (!mod || keyringDegraded) return null;
    try {
        return await readWithPriorFallback(mod, refreshAccount(account));
    } catch {
        return null;
    }
}

/**
 * Store the refresh token in the new service.
 */
export async function setRefreshToken(account: string, token: string): Promise<boolean> {
    const mod = loadKeyring();
    if (!mod || keyringDegraded) return false;
    try {
        const result = await runKeyringOp(mod.setPassword(KEYRING_SERVICE, refreshAccount(account), token));
        return result !== KEYRING_TIMED_OUT;
    } catch {
        return false;
    }
}

/**
 * Delete the refresh token from BOTH the new and prior services.
 */
export async function deleteRefreshToken(account: string): Promise<boolean> {
    const mod = loadKeyring();
    if (!mod || keyringDegraded) return false;
    try {
        return await deleteFromBothServices(mod, refreshAccount(account));
    } catch {
        return false;
    }
}
