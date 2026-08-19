/**
 * Describes whether the integration environment satisfies all registered readiness checks, and if not, why.
 * Kept deliberately generic (no tenant/subscription specifics) so this harness stays reusable across every
 * integration suite (tenant-only, subscription-backed, storage/Data Gateway, etc.).
 */
export interface EnvironmentReadiness {
    /** Whether every registered readiness check passed. */
    'ready': boolean;
    /** Human-readable explanation of the first failing check. Undefined when `ready` is true. */
    'reason': string | undefined;
}

/**
 * Testable environment variable definition supporting key presence and custom validation.
 */
export interface TestableEnvironmentVariable {
    /** The environment variable key name. */
    'key': string;
    /**
     * Optional check function to validate the environment variable value.
     * @param value The non-empty value of the environment variable.
     * @returns Result indicating validation success or failure with an optional reason.
     */
    'check'?: (value: string) => EnvironmentVariableCheckResult;
}

/**
 * Result of a custom environment variable validation check.
 */
export interface EnvironmentVariableCheckResult {
    /** Whether the environment variable passed validation. */
    'success': boolean;
    /** Reason describing the check outcome or failure. */
    'reason'?: string;
}
