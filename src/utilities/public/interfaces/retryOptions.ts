/**
 * Options for configuring the behavior of the `retry` utility function.
 */
export interface RetryOptions {
    'timeoutMs': number;
    'initialIntervalMs'?: number;
    'maxIntervalMs'?: number;
    'backoffMultiplier'?: number;
    'jitterRatio'?: number;
    'signal'?: AbortSignal;
    'shouldRetry'?: (error: unknown, attempt: number) => boolean;
}
