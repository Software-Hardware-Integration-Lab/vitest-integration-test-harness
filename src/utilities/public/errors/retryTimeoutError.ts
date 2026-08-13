/**
 * Represents an error that occurs when a retry operation exceeds the specified timeout.
 */
export class RetryTimeoutError extends Error {
    constructor(public readonly attempts: number, public readonly lastError: unknown) {
        super(`Retry operation timed out after ${ attempts } attempts. Last error: ${ lastError instanceof Error ? lastError.message : String(lastError) }`);

        this.name = 'RetryTimeoutError';
    }
}
