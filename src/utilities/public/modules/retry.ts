import { setTimeout as sleep } from 'node:timers/promises';
import { PollPredicateMismatchError } from '../errors/pollPredicateMismatchError.js';
import { RetryTimeoutError } from '../errors/retryTimeoutError.js';
import type { PollResult } from '../interfaces/pollResult.js';
import type { RetryOptions } from '../interfaces/retryOptions.js';

/** Largest delay accepted by Node.js timer APIs without being clamped to approximately one millisecond. */
const maximumTimerDelayMs = 2_147_483_647;

interface ResolvedRetryOptions {
    'timeoutMs': number;
    'initialIntervalMs': number;
    'maxIntervalMs': number;
    'backoffMultiplier': number;
    'jitterRatio': number;
    'signal': AbortSignal | undefined;
    'shouldRetry': (error: unknown, attempt: number) => boolean;
}

function resolveRetryOptions(options: RetryOptions): ResolvedRetryOptions {
    const initialIntervalMs = options.initialIntervalMs ?? 100;

    const maxIntervalMs = options.maxIntervalMs ?? initialIntervalMs;

    const backoffMultiplier = options.backoffMultiplier ?? 1;

    const jitterRatio = options.jitterRatio ?? 0;

    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > maximumTimerDelayMs) {
        throw new RangeError(`timeoutMs must be a finite number from 1 through ${ maximumTimerDelayMs }.`);
    }

    if (!Number.isFinite(initialIntervalMs) || initialIntervalMs < 0 || initialIntervalMs > maximumTimerDelayMs) {
        throw new RangeError(`initialIntervalMs must be a finite number from 0 through ${ maximumTimerDelayMs }.`);
    }

    if (!Number.isFinite(maxIntervalMs) || maxIntervalMs < initialIntervalMs || maxIntervalMs > maximumTimerDelayMs) {
        throw new RangeError(`maxIntervalMs must be a finite number from ${ initialIntervalMs } through ${ maximumTimerDelayMs }.`);
    }

    if (!Number.isFinite(backoffMultiplier) || backoffMultiplier < 1) {
        throw new RangeError('backoffMultiplier must be finite and at least 1.');
    }

    if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
        throw new RangeError('jitterRatio must be a finite number from 0 through 1.');
    }

    return {
        'timeoutMs': options.timeoutMs,
        initialIntervalMs,
        maxIntervalMs,
        backoffMultiplier,
        jitterRatio,
        'signal': options.signal,
        'shouldRetry': options.shouldRetry ?? (() : boolean => true)
    };
}

function remainingMs(deadline: bigint): number {
    const remainingNs = deadline - process.hrtime.bigint();

    return remainingNs <= 0n ? 0 : Number(remainingNs / 1_000_000n);
}

function elapsedMs(startedAt: bigint): number {
    return Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
}

function addJitter(delayMs: number, jitterRatio: number): number {
    const jitterOffset = ((Math.random() * 2) - 1) * jitterRatio;

    return Math.round(delayMs * (1 + jitterOffset));
}

function abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error
        ? signal.reason
        : new DOMException('The operation was aborted.', 'AbortError');
}

function createAbortPromise(signal: AbortSignal): {
    'promise': Promise<never>;
    'dispose': () => void;
} {
    let abortListener: (() => void) | undefined;

    const promise = new Promise<never>((_resolve, reject): void => {
        abortListener = (): void => { reject(abortReason(signal)); };

        signal.addEventListener('abort', abortListener, { 'once': true });
    });

    if (signal.aborted) {
        abortListener!();
    }

    return {
        promise,
        'dispose': (): void => { signal.removeEventListener('abort', abortListener!); }
    };
}

async function sleepWithSignal(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
    try {
        await sleep(delayMs, void 0, { signal });
    } catch (error) {
        if (signal?.aborted) {
            throw abortReason(signal);
        }

        throw error;
    }
}

/**
 * Retries the provided operation until it succeeds or the specified timeout is reached. The retry behavior can be configured using the provided options.
 * @template T The type of the value returned by the operation.
 * @param operation The operation to be retried, which can return a value or a promise that resolves to a value.
 * @param options Configuration options for the retry behavior, including timeout, intervals, backoff multiplier, and an optional abort signal.
 * @returns A promise that resolves to a `PollResult` containing the final value obtained, the number of attempts made, and the total elapsed time in milliseconds.
 * @throws {RetryTimeoutError} If the operation does not succeed within the specified timeout.
 */
export async function retry<T>(
    operation: (signal: AbortSignal) => T | Promise<T>,
    options: RetryOptions
): Promise<PollResult<T>> {
    const resolvedOptions = resolveRetryOptions(options);

    const startedAt = process.hrtime.bigint();

    const timeoutNs = BigInt(Math.ceil(resolvedOptions.timeoutMs)) * 1_000_000n;

    const deadline = startedAt + timeoutNs;

    let delayMs = resolvedOptions.initialIntervalMs;

    let attempts = 0;

    let lastError: unknown;

    for (; ;) {
        if (resolvedOptions.signal?.aborted) {
            throw abortReason(resolvedOptions.signal);
        }

        if (remainingMs(deadline) <= 0) {
            throw new RetryTimeoutError(attempts, lastError);
        }

        attempts += 1;

        const timeoutError = new RetryTimeoutError(attempts, lastError);

        const timeoutController = new AbortController();

        const timeout = setTimeout(() => { timeoutController.abort(timeoutError); }, remainingMs(deadline));

        const operationSignal = resolvedOptions.signal === void 0
            ? timeoutController.signal
            : AbortSignal.any([resolvedOptions.signal, timeoutController.signal]);

        const abort = createAbortPromise(operationSignal);

        try {
            const value = await Promise.race([operation(operationSignal), abort.promise]);

            return {
                value,
                attempts,
                'elapsedMs': elapsedMs(startedAt)
            };
        } catch (error) {
            if (timeoutController.signal.aborted) {
                throw timeoutError;
            }

            if (resolvedOptions.signal?.aborted) {
                throw abortReason(resolvedOptions.signal);
            }

            lastError = error;

            if (!resolvedOptions.shouldRetry(error, attempts)) {
                throw error;
            }
        } finally {
            clearTimeout(timeout);

            abort.dispose();
        }

        const remaining = remainingMs(deadline);

        if (remaining <= 0) {
            throw new RetryTimeoutError(attempts, lastError);
        }

        const jitteredDelayMs = addJitter(delayMs, resolvedOptions.jitterRatio);

        await sleepWithSignal(Math.min(jitteredDelayMs, remaining), resolvedOptions.signal);

        delayMs = Math.min(delayMs * resolvedOptions.backoffMultiplier, resolvedOptions.maxIntervalMs);
    }
}

/**
 * Polls a check until its value satisfies the provided predicate or the timeout is reached.
 * @template T The type of the value returned by the check.
 * @param check Operation that retrieves the value to evaluate.
 * @param predicate Condition that the retrieved value must satisfy.
 * @param options Configuration options for timeout, intervals, backoff, and cancellation.
 * @returns The value satisfying the predicate, together with attempt and elapsed-time metadata.
 * @throws {RetryTimeoutError} If the predicate is not satisfied before the timeout.
 */
export async function pollUntil<T>(
    check: (signal: AbortSignal) => T | Promise<T>,
    predicate: (value: T) => boolean,
    options: RetryOptions
): Promise<PollResult<T>> {
    return retry(async (signal) => {
        const value = await check(signal);

        if (!predicate(value)) {
            throw new PollPredicateMismatchError(value);
        }

        return value;
    }, options);
}
