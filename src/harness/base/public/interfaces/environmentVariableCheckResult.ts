/**
 * Result of a custom environment variable validation check.
 */
export interface EnvironmentVariableCheckResult {
    /** Whether the environment variable passed validation. */
    'success': boolean;
    /** Reason describing the check outcome or failure. */
    'reason'?: string;
}
