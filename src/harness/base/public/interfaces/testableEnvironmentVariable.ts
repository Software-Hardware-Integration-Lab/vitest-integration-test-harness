import type { EnvironmentVariableCheckResult } from './environmentVariableCheckResult.js';

/**
 * Testable environment variable definition supporting key presence and custom validation.
 */
export default interface TestableEnvironmentVariable {
    /** The environment variable key name. */
    'key': string;
    /**
     * Optional check function to validate the environment variable value.
     * @param value The non-empty value of the environment variable.
     * @returns Result indicating validation success or failure with an optional reason.
     */
    'check'?: (value: string) => EnvironmentVariableCheckResult;
}
