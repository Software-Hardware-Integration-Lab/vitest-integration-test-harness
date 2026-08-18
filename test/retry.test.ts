import { describe, expect, it, vi } from 'vitest';
import { MaxRetryAttemptsReachedError, pollUntil, retry, RetryTimeoutError } from '../src/index.js';

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

        const reason = new Error('caller canceled retry');

        const pendingRetry = retry(() => { throw new Error('transient failure'); }, {
            'timeoutMs': 1_000,
            'initialIntervalMs': 1_000,
            'signal': controller.signal
        });

        controller.abort(reason);

        await expect(pendingRetry).rejects.toBe(reason);
    });

    it('times out an operation that remains in progress past the deadline', async () => {
        const operation = vi.fn(() => new Promise<string>(() => { /* Intentionally never settles. */ }));

        await expect(retry(operation, { 'timeoutMs': 10 })).rejects.toBeInstanceOf(RetryTimeoutError);

        expect(operation).toHaveBeenCalledOnce();
    });

    it('rejects a successful synchronous operation that blocks past the deadline', async () => {
        await expect(retry(() => {
            const blockingDeadline = process.hrtime.bigint() + 20_000_000n;

            while (process.hrtime.bigint() < blockingDeadline) { /* Intentionally blocks the event loop. */ }

            return 'late success';
        }, { 'timeoutMs': 1 })).rejects.toBeInstanceOf(RetryTimeoutError);
    });

    it('cancels an in-progress operation and passes its signal to the operation', async () => {
        const controller = new AbortController();

        const reason = new Error('caller canceled retry');

        let operationSignal: AbortSignal | undefined;

        const pendingRetry = retry((signal) => {
            operationSignal = signal;

            return new Promise<string>(() => { /* Intentionally never settles. */ });
        }, {
            'timeoutMs': 1_000,
            'signal': controller.signal
        });

        controller.abort(reason);

        await expect(pendingRetry).rejects.toBe(reason);

        expect(operationSignal?.aborted).toBe(true);
    });

    it('immediately rethrows an error rejected by shouldRetry', async () => {
        const permanentError = new Error('invalid request');

        await expect(retry(() => { throw permanentError; }, {
            'timeoutMs': 100,
            'shouldRetry': () => false
        })).rejects.toBe(permanentError);
    });

    it('uses an AbortError when the caller aborts without a reason', async () => {
        const controller = new AbortController();

        controller.abort();

        await expect(retry(() => 'unused', {
            'timeoutMs': 100,
            'signal': controller.signal
        })).rejects.toMatchObject({ 'name': 'AbortError' });
    });

    it.each([
        [
            'backoffMultiplier',
            {
                'timeoutMs': 1,
                'backoffMultiplier': 0
            }
        ],
        [
            'jitterRatio',
            {
                'timeoutMs': 1,
                'jitterRatio': -0.1
            }
        ]
    ])('rejects an invalid %s value', async (_optionName, options) => {
        await expect(retry(() => 'unused', options)).rejects.toBeInstanceOf(RangeError);
    });

    it('retains the final mismatched poll value in the timeout error', async () => {
        const finalValue = { 'status': 'creating' };

        try {
            await pollUntil(() => finalValue, (value) => value.status === 'ready', {
                'timeoutMs': 10,
                'initialIntervalMs': 0
            });

            expect.unreachable('pollUntil should time out');
        } catch (error) {
            expect(error).toBeInstanceOf(RetryTimeoutError);

            expect((error as RetryTimeoutError).lastError).toMatchObject({ 'lastValue': finalValue });
        }
    });

    it.each([
        [
            'fractional timeoutMs',
            { 'timeoutMs': 1.5 }
        ],
        [
            'fractional initialIntervalMs',
            {
                'timeoutMs': 1,
                'initialIntervalMs': 0.5
            }
        ],
        [
            'fractional maxIntervalMs',
            {
                'timeoutMs': 1,
                'initialIntervalMs': 0,
                'maxIntervalMs': 0.5
            }
        ],
        ['zero timeoutMs', { 'timeoutMs': 0 }],
        ['timeoutMs', { 'timeoutMs': 2_147_483_648 }],
        [
            'initialIntervalMs',
            {
                'timeoutMs': 1,
                'initialIntervalMs': 2_147_483_648
            }
        ],
        [
            'maxIntervalMs',
            {
                'timeoutMs': 1,
                'initialIntervalMs': 0,
                'maxIntervalMs': 2_147_483_648
            }
        ]
    ])('rejects a %s value beyond the Node timer limit', async (_optionName, options) => {
        await expect(retry(() => 'unused', options)).rejects.toBeInstanceOf(RangeError);
    });

    it.each([
        [
            'NEGATIVE_INFINITY maxRetryAttempts',
            {
                'timeoutMs': 100,
                'maxRetryAttempts': Number.NEGATIVE_INFINITY
            }
        ],
        [
            'negative maxRetryAttempts',
            {
                'timeoutMs': 100,
                'maxRetryAttempts': -1
            }
        ],
        [
            'zero maxRetryAttempts',
            {
                'timeoutMs': 100,
                'maxRetryAttempts': 0
            }
        ],
        [
            'NaN maxRetryAttempts',
            {
                'timeoutMs': 100,
                'maxRetryAttempts': Number.NaN
            }
        ],
        [
            'fractional maxRetryAttempts',
            {
                'timeoutMs': 100,
                'maxRetryAttempts': 1.5
            }
        ]
    ])('rejects a %s value', async (_optionName, options) => {
        await expect(retry(() => 'unused', options)).rejects.toBeInstanceOf(RangeError);
    });

    it('accepts POSITIVE_INFINITY for maxRetryAttempts and retries until timeout', async () => {
        const operation = vi.fn()
            .mockImplementationOnce(() => {
                throw new Error('transient failure');
            })
            .mockReturnValue('created resource');

        const result = await retry(operation, {
            'timeoutMs': 100,
            'initialIntervalMs': 0,
            'maxRetryAttempts': Number.POSITIVE_INFINITY
        });

        expect(result.value).toBe('created resource');

        expect(result.attempts).toBe(2);
    });

    it('throws MaxRetryAttemptsReachedError once the attempt limit is reached before the timeout', async () => {
        const finalError = new Error('service remains unavailable');

        const operation = vi.fn(() => {
            throw finalError;
        });

        try {
            await retry(operation, {
                'timeoutMs': 10_000,
                'initialIntervalMs': 0,
                'maxRetryAttempts': 2
            });

            expect.unreachable('retry should reach the max retry attempts');
        } catch (error) {
            expect(error).toBeInstanceOf(MaxRetryAttemptsReachedError);

            expect(operation).toHaveBeenCalledTimes(3);

            expect((error as MaxRetryAttemptsReachedError).attempts).toBe(3);

            expect((error as Error).message).toBe('Max number of retry attempts reached (2) after 3 total attempts. Last error: service remains unavailable');

            expect((error as MaxRetryAttemptsReachedError).lastError).toBe(finalError);
        }
    });

    it('succeeds when an attempt within the maxRetryAttempts budget resolves before the timeout', async () => {
        const operation = vi.fn()
            .mockImplementationOnce(() => {
                throw new Error('transient failure');
            })
            .mockReturnValue('created resource');

        const result = await retry(operation, {
            'timeoutMs': 100,
            'initialIntervalMs': 0,
            'maxRetryAttempts': 2
        });

        expect(result.value).toBe('created resource');

        expect(result.attempts).toBe(2);
    });

    it('prioritizes the timeout deadline over maxRetryAttempts when both are exceeded together', async () => {
        await expect(retry(() => {
            throw new Error('transient failure');
        }, {
            'timeoutMs': 10,
            'initialIntervalMs': 1,
            'maxRetryAttempts': 1_000
        })).rejects.toBeInstanceOf(RetryTimeoutError);
    });

    it('includes the operation context in the RetryTimeoutError message', async () => {
        try {
            await retry(() => {
                throw new Error('transient failure');
            }, {
                'timeoutMs': 10,
                'initialIntervalMs': 1,
                'operationContext': 'create-resource'
            });

            expect.unreachable('retry should time out');
        } catch (error) {
            expect(error).toBeInstanceOf(RetryTimeoutError);

            expect((error as RetryTimeoutError).context).toBe('create-resource');

            expect((error as Error).message.startsWith('[create-resource] Retry operation timed out')).toBe(true);
        }
    });

    it('includes the operation context in the MaxRetryAttemptsReachedError message', async () => {
        try {
            await retry(() => {
                throw new Error('transient failure');
            }, {
                'timeoutMs': 10_000,
                'initialIntervalMs': 0,
                'maxRetryAttempts': 1,
                'operationContext': 'poll-status'
            });

            expect.unreachable('retry should reach the max retry attempts');
        } catch (error) {
            expect(error).toBeInstanceOf(MaxRetryAttemptsReachedError);

            expect((error as MaxRetryAttemptsReachedError).context).toBe('poll-status');

            expect((error as Error).message.startsWith('[poll-status] Max number of retry attempts reached')).toBe(true);
        }
    });

    it('omits the context prefix from the RetryTimeoutError message when operationContext is not provided', async () => {
        try {
            await retry(() => {
                throw new Error('transient failure');
            }, {
                'timeoutMs': 10,
                'initialIntervalMs': 1
            });

            expect.unreachable('retry should time out');
        } catch (error) {
            expect((error as RetryTimeoutError).context).toBeUndefined();

            expect((error as Error).message.startsWith('[')).toBe(false);
        }
    });

    it('omits the context prefix from the RetryTimeoutError message when operationContext is whitespace', async () => {
        try {
            await retry(() => {
                throw new Error('transient failure');
            }, {
                'timeoutMs': 10,
                'initialIntervalMs': 1,
                'operationContext': '   '
            });

            expect.unreachable('retry should time out');
        } catch (error) {
            expect((error as RetryTimeoutError).context).toBe('   ');

            expect((error as Error).message.startsWith('[')).toBe(false);
        }
    });

    it('carries the operation context through pollUntil into the RetryTimeoutError message', async () => {
        const finalValue = { 'status': 'creating' };

        try {
            await pollUntil(() => finalValue, (value) => value.status === 'ready', {
                'timeoutMs': 10,
                'initialIntervalMs': 0,
                'operationContext': 'wait-for-ready'
            });

            expect.unreachable('pollUntil should time out');
        } catch (error) {
            expect(error).toBeInstanceOf(RetryTimeoutError);

            expect((error as RetryTimeoutError).context).toBe('wait-for-ready');

            expect((error as Error).message.startsWith('[wait-for-ready] Retry operation timed out')).toBe(true);
        }
    });

    it('carries the operation context through pollUntil into the MaxRetryAttemptsReachedError message', async () => {
        const finalValue = { 'status': 'creating' };

        try {
            await pollUntil(() => finalValue, (value) => value.status === 'ready', {
                'timeoutMs': 10_000,
                'initialIntervalMs': 0,
                'maxRetryAttempts': 1,
                'operationContext': 'wait-for-ready'
            });

            expect.unreachable('pollUntil should reach the max retry attempts');
        } catch (error) {
            expect(error).toBeInstanceOf(MaxRetryAttemptsReachedError);

            expect((error as MaxRetryAttemptsReachedError).context).toBe('wait-for-ready');

            expect((error as Error).message.startsWith('[wait-for-ready] Max number of retry attempts reached')).toBe(true);
        }
    });
});
