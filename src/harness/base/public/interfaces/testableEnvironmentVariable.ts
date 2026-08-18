import type { EnvironmentVariableCheckResult } from './environmentVariableCheckResult.js';

/**
 * Testable environment variable definition supporting key presence and custom validation.
 */
export default interface TestableEnvironmentVariable {
    /** The environment variable key name. */
    'key': string;
    /** Optional check function to validate the environment variable. */
    'check'?: () => EnvironmentVariableCheckResult;
}
