/**
 * Unit-only: argument plumbing for the HTTP listen host (no real socket bound).
 *
 * A plain app double records the arguments `startHttpServerWithErrorHandling`
 * hands to `app.listen`. The default matters: callers that pass no host must
 * keep binding `0.0.0.0` exactly as before, while a caller that supplies a host
 * (e.g. `127.0.0.1` for a loopback-only integration listener) gets it verbatim.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { Express } from 'express';
import { startHttpServerWithErrorHandling } from '../../src/http/http-server-startup.js';

function listenDouble() {
    return jest.fn((..._args: unknown[]) => ({ on: jest.fn() }));
}

describe('startHttpServerWithErrorHandling bind host', () => {
    it('keeps binding 0.0.0.0 when no host is supplied', () => {
        const listen = listenDouble();
        startHttpServerWithErrorHandling({ listen } as unknown as Express, 3300);

        expect(listen).toHaveBeenCalledTimes(1);
        expect(listen.mock.calls[0][0]).toBe(3300);
        expect(listen.mock.calls[0][1]).toBe('0.0.0.0');
        expect(typeof listen.mock.calls[0][2]).toBe('function');
    });

    it('passes an explicit host through to app.listen', () => {
        const listen = listenDouble();
        startHttpServerWithErrorHandling({ listen } as unknown as Express, 0, '127.0.0.1');

        expect(listen).toHaveBeenCalledTimes(1);
        expect(listen.mock.calls[0][0]).toBe(0);
        expect(listen.mock.calls[0][1]).toBe('127.0.0.1');
    });
});
