// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/**
 * Auth-related errors and handling (401 with login_url).
 * Auth message is written without "Error: " prefix; --open can open the URL.
 */

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';
import { isAbsolute } from 'path';
import { writeError, writeStderr } from './output.js';

export class AuthRequiredError extends Error {
    readonly loginUrl: string;

    constructor(message: string, loginUrl: string) {
        super(message);
        this.name = 'AuthRequiredError';
        this.loginUrl = loginUrl;
    }
}

/** True when BROWSER=true (tests/automation) or none/no/false/0; use in scripts/tests to disable opening. */
export function isBrowserDisabled(): boolean {
    if (process.env['KAIROS_NO_BROWSER'] === '1') return true;
    const b = process.env['BROWSER'];
    return b != null && b !== '' && /^(true|none|no|false|0)$/i.test(b);
}

interface BrowserLaunchCommand {
    file: string;
    args: string[];
}

const ALLOWED_BROWSER_BINARIES = new Set([
    'brave',
    'brave-browser',
    'chrome',
    'chromium',
    'chromium-browser',
    'firefox',
    'google-chrome',
    'google-chrome-stable',
    'microsoft-edge',
    'msedge',
    'open',
    'rundll32.exe',
    'safari',
    'xdg-open',
]);

function normalizeBrowserUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed || /[\r\n\t\x00]/.test(trimmed)) {
        throw new Error('Browser URL contains invalid control characters');
    }
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported browser URL protocol: ${parsed.protocol}`);
    }
    return parsed.toString();
}

function resolveCustomBrowser(browserEnv: string, url: string): BrowserLaunchCommand | null {
    const trimmed = browserEnv.trim();
    if (!trimmed) return null;
    if (/["'`$&|;<>]/.test(trimmed)) return null;
    if (/\s/.test(trimmed)) {
        if (isAbsolute(trimmed) && existsSync(trimmed)) {
            return { file: trimmed, args: [url] };
        }
        return null;
    }
    if (!ALLOWED_BROWSER_BINARIES.has(trimmed) && !(isAbsolute(trimmed) && existsSync(trimmed))) {
        return null;
    }
    return { file: trimmed, args: [url] };
}

function resolveSystemBrowser(url: string): BrowserLaunchCommand {
    if (platform() === 'win32') {
        return { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
    }
    if (platform() === 'darwin') {
        return { file: 'open', args: [url] };
    }
    return { file: 'xdg-open', args: [url] };
}

function runBrowser(launch: BrowserLaunchCommand, url: string, errorPrefix: string): void {
    execFile(launch.file, launch.args, (err) => {
        if (err) writeStderr(`${errorPrefix}: ${err.message}. Open this URL manually:\n${url}`);
    });
}

/** When set, used instead of system default (open/xdg-open/start). BROWSER=true or none skips opening. */
export function openBrowser(url: string): void {
    if (isBrowserDisabled()) return;
    let safeUrl: string;
    try {
        safeUrl = normalizeBrowserUrl(url);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid browser URL';
        writeStderr(`${message}. Open this URL manually:\n${url}`);
        return;
    }

    const browserEnv = process.env['BROWSER'];
    if (browserEnv != null && browserEnv !== '') {
        const customLaunch = resolveCustomBrowser(browserEnv, safeUrl);
        if (customLaunch) {
            runBrowser(customLaunch, safeUrl, 'Could not run BROWSER');
            return;
        }
        writeStderr(`Ignoring unsafe BROWSER override. Falling back to system browser for:\n${safeUrl}`);
    }
    runBrowser(resolveSystemBrowser(safeUrl), safeUrl, 'Could not open browser');
}

/**
 * Handle API errors: AuthRequiredError is printed without "Error: " prefix;
 * if openInBrowser is true, opens the login URL. Other errors use writeError.
 * Never returns (calls process.exit(1)).
 */
export function handleApiError(error: unknown, openInBrowser?: boolean): never {
    if (error instanceof AuthRequiredError) {
        writeStderr(error.message);
        if (openInBrowser) openBrowser(error.loginUrl);
        process.exit(1);
    }
    writeError(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
