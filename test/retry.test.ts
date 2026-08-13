import { describe, expect, it, vi } from 'vitest';
import { pollUntil, retry, RetryTimeoutError } from '../src/index.js';

void describe('retry utilities', () => {
    it('retries transient failures and returns attempt metadata', async () => {
        const operation = vi.fn()
            .mockImplementationOnce(() => { throw new Error('transient failure'); })
            .mockImplementationOnce(() => { throw new Error('still unavailable'); })
            .mockReturnValue('created resource');

        const result = await retry(operation, {
            'timeoutMs': 100,
            'initialIntervalMs': 0
        });

        expect(result.value).toBe('created resource');

        expect(result.attempts).toBe(3);

        expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('polls until the check value satisfies the predicate', async () => {
        interface ResourceState {
            'status': string;
        }

        const check = vi.fn<() => ResourceState>()
            .mockReturnValueOnce({ 'status': 'creating' })
            .mockReturnValueOnce({ 'status': 'ready' });

        const result = await pollUntil(
            check,
            (resource) => resource.status === 'ready',
            {
                'timeoutMs': 100,
                'initialIntervalMs': 0
            }
        );

        expect(result.value).toEqual({ 'status': 'ready' });

        expect(result.attempts).toBe(2);
    });

    it('increases retry delays using the configured bounded backoff', async () => {
        const attemptTimes: bigint[] = [];

        const operation = vi.fn(() => {
            attemptTimes.push(process.hrtime.bigint());

            if (attemptTimes.length < 3) {
                throw new Error('transient failure');
            }

            return 'created resource';
        });

        await retry(operation, {
            'timeoutMs': 200,
            'initialIntervalMs': 10,
            'maxIntervalMs': 20,
            'backoffMultiplier': 2
        });

        const firstDelayMs = Number((attemptTimes[1]! - attemptTimes[0]!) / 1_000_000n);

        const secondDelayMs = Number((attemptTimes[2]! - attemptTimes[1]!) / 1_000_000n);

        expect(firstDelayMs).toBeGreaterThanOrEqual(5);

        expect(secondDelayMs).toBeGreaterThanOrEqual(15);
    });

    it('applies the configured symmetric jitter to retry delays', async () => {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

        const attemptTimes: bigint[] = [];

        try {
            await retry(() => {
                attemptTimes.push(process.hrtime.bigint());

                if (attemptTimes.length === 1) {
                    throw new Error('transient failure');
                }

                return 'created resource';
            }, {
                'timeoutMs': 200,
                'initialIntervalMs': 40,
                'jitterRatio': 0.5
            });
        } finally {
            randomSpy.mockRestore();
        }

        const delayMs = Number((attemptTimes[1]! - attemptTimes[0]!) / 1_000_000n);

        expect(delayMs).toBeGreaterThanOrEqual(15);

        expect(delayMs).toBeLessThan(40);
    });

    it('reports the final operation error when the retry deadline expires', async () => {
        const finalError = new Error('service remains unavailable');

        try {
            await retry(() => { throw finalError; }, {
                'timeoutMs': 10,
                'initialIntervalMs': 1
            });

            expect.unreachable('retry should time out');
        } catch (error) {
            expect(error).toBeInstanceOf(RetryTimeoutError);

            expect((error as RetryTimeoutError).attempts).toBeGreaterThan(0);

            expect((error as RetryTimeoutError).lastError).toBe(finalError);
        }
    });

    it('honors a signal that was already aborted without running the operation', async () => {
        const controller = new AbortController();

        const reason = new Error('caller canceled retry');

        const operation = vi.fn();

        controller.abort(reason);

        await expect(retry(operation, {
            'timeoutMs': 100,
            'signal': controller.signal
        })).rejects.toBe(reason);

        expect(operation).not.toHaveBeenCalled();
    });

    it('cancels while waiting for the next retry attempt', async () => {
        const controller = new AbortController();

        const pendingRetry = retry(() => { throw new Error('transient failure'); }, {
            'timeoutMs': 1_000,
            'initialIntervalMs': 1_000,
            'signal': controller.signal
        });

        controller.abort();

        await expect(pendingRetry).rejects.toMatchObject({ 'name': 'AbortError' });
    });
});
