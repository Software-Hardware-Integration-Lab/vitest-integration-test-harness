/**
 * Describes whether the integration environment satisfies all registered readiness checks, and if not, why.
 * Kept deliberately generic (no tenant/subscription specifics) so this harness stays reusable across every
 * integration suite (tenant-only, subscription-backed, storage/Data Gateway, etc).
 */
export default interface EnvironmentReadiness {
    /** Whether every registered readiness check passed. */
    'ready': boolean;
    /** Human readable explanation of the first failing check. Undefined when `ready` is true. */
    'reason': string | undefined;
}
