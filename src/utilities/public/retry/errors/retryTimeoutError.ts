import { ScopedError } from './scopedError.js';

/**
 * Represents an error that occurs when a retry operation exceeds the specified timeout.
 */
export class RetryTimeoutError extends ScopedError {
    constructor(public readonly attempts: number, public readonly lastError: unknown, public readonly context?: string) {
        const error = lastError instanceof Error ? lastError.message : String(lastError);

        super(`Retry operation timed out after ${ attempts } attempts. Last error: ${ error }`, context);

        this.name = 'RetryTimeoutError';
    }
}
