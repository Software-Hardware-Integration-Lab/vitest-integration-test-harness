import { ScopedError } from './scopedError.js';

/**
 * Represents an error that occurs when a retry operation exceeds the specified max retry attempts.
 */
export class MaxRetryAttemptsReachedError extends ScopedError {
    constructor(public readonly attempts: number, public readonly lastError: unknown, public readonly context?: string) {
        const error = lastError instanceof Error ? lastError.message : String(lastError);
        const retryAttempts = Math.max(0, attempts - 1);

        super(`Max number of retry attempts reached (${ retryAttempts }) after ${ attempts } total attempts. Last error: ${ error }`, context);

        this.name = 'MaxRetryAttemptsReachedError';
    }
}
