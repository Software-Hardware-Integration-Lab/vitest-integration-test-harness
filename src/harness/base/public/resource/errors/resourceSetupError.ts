import type { ResourceFailure } from '../resourceTypes.js';

/** Raised when one or more resource setup actions fail. */
export default class ResourceSetupError extends Error {
    /** The individual failures encountered while attempting resource setup. */
    public readonly failures: readonly ResourceFailure[];

    /**
     * Creates the aggregate setup error.
     * @param failures Collection of description/error pairs for every setup call that failed.
     * @param testName Name of the test whose resource setup failed, included for traceability.
     */
    constructor(failures: readonly ResourceFailure[], testName: string) {
        /** Human-readable reason for each failed setup action. */
        const details = failures
            .map(({ description, error }) => {
                const reason = error instanceof Error
                    ? error.message
                    : String(error);

                return `${ description }: ${ reason }`;
            }).join(';\n');

        const message = `[${ testName }] ${ failures.length } resource setup ` +
            `${ failures.length === 1 ? 'action' : 'actions' } failed:\n ${ details }`;

        super(message, { 'cause': failures[0]?.error });

        this.name = 'ResourceSetupError';

        this.failures = failures;
    }
}
