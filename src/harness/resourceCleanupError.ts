/** Describes a single cleanup action that failed, captured while attempting to restore all tracked resources. */
export interface ResourceCleanupFailure {
    /** Description of the resource whose cleanup failed. */
    'description': string;
    /** The error raised while attempting cleanup. */
    'error': unknown;
}

/** Raised when one or more tracked resource cleanups fail, after every cleanup has still been attempted. */
export default class ResourceCleanupError extends Error {
    /** The individual failures encountered while cleaning up tracked resources, in the order they occurred. */
    public readonly failures: readonly ResourceCleanupFailure[];

    /**
     * Creates the aggregate cleanup error.
     * @param failures Collection of description/error pairs for every cleanup call that failed.
     * @param testName Name of the test the failed cleanups belong to, included in the message for traceability.
     */
    constructor(failures: readonly ResourceCleanupFailure[], testName: string) {
        /** Human readable summary of every failed cleanup, used as the error's message. */
        const details = failures
            .map(({ description, error }) => {
                /** Human readable reason for the cleanup failure, derived from the error object. */
                const reason = error instanceof Error ? `${ error.message }\n${ error.stack }` : String(error);

                return `${ description }: ${ reason }`;
            }).join(';\n');

        /** Human readable summary of every failed cleanup, used as the error's message. */
        const message = `[${ testName }] ${ failures.length } resource cleanup ` +
            `${ failures.length === 1 ? 'action' : 'actions' } failed:\n ${ details }`;

        super(message);

        this.name = 'ResourceCleanupError';

        this.failures = failures;
    }
}
