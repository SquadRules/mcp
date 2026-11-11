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

/**
 * The bind-failure contract (ADR 0049, issue #293/#297).
 *
 * `app.listen()` reports a failed bind on the server's `error` event, i.e. after the
 * caller already holds the listener, in a process that has loaded the native embedding
 * model. A `process.exit()` there aborts the live ONNX session instead of reporting the
 * port conflict, so the decision belongs to the resource owner: the module logs, releases
 * the socket it created, and delegates. These doubles drive the event handler directly -
 * no real socket is bound, which is why this stays a unit test.
 */
describe('startHttpServerWithErrorHandling bind failure', () => {
    const EADDRINUSE: NodeJS.ErrnoException = Object.assign(
        new Error('listen EADDRINUSE: address already in use'),
        { code: 'EADDRINUSE' }
    );

    /** An app double whose listener records the `error` handler and can replay a failure. */
    function failureDouble() {
        const handlers: Array<(error: NodeJS.ErrnoException) => void> = [];
        const close = jest.fn((callback?: (error?: Error) => void) => {
            callback?.(new Error('Server is not running.'));
        });
        const listen = jest.fn(() => ({
            on: (event: string, handler: (error: NodeJS.ErrnoException) => void) => {
                if (event === 'error') handlers.push(handler);
            },
            close
        }));
        return {
            listen,
            close,
            emitError: (error: NodeJS.ErrnoException) => {
                for (const handler of handlers) handler(error);
            }
        };
    }

    it('delegates to the owner and never exits the process itself', () => {
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((): never => {
            throw new Error('process.exit() must not run on the HTTP startup failure path (ADR 0049)');
        });
        try {
            const double = failureDouble();
            const onFatalError = jest.fn();
            startHttpServerWithErrorHandling(
                { listen: double.listen } as unknown as Express,
                3300,
                '0.0.0.0',
                { onFatalError }
            );

            double.emitError(EADDRINUSE);

            expect(onFatalError).toHaveBeenCalledTimes(1);
            expect(onFatalError).toHaveBeenCalledWith(EADDRINUSE);
            expect(exitSpy).not.toHaveBeenCalled();
            // This module created the socket, so it releases it before anyone acts on it.
            expect(double.close).toHaveBeenCalledTimes(1);
        } finally {
            exitSpy.mockRestore();
        }
    });

    it('reports a nonzero status through process.exitCode when no owner is supplied', () => {
        const previousExitCode = process.exitCode;
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((): never => {
            throw new Error('process.exit() must not run on the HTTP startup failure path (ADR 0049)');
        });
        try {
            const double = failureDouble();
            startHttpServerWithErrorHandling({ listen: double.listen } as unknown as Express, 3300);

            double.emitError(EADDRINUSE);

            // A process that owns nothing else still ends nonzero; one that owns a handle
            // reaches its own teardown instead of aborting inside this module.
            expect(process.exitCode).toBe(1);
            expect(exitSpy).not.toHaveBeenCalled();
        } finally {
            process.exitCode = previousExitCode;
            exitSpy.mockRestore();
        }
    });
});
