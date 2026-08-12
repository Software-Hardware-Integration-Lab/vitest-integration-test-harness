/**
 * Describes whether the integration environment satisfies all registered readiness checks, and if not, why.
 * Kept deliberately generic (no tenant/subscription specifics) so this harness stays reusable across every
 * integration suite (tenant-only, subscription-backed, storage/Data Gateway, etc).
 */
export interface EnvironmentReadiness {
    /** Whether every registered readiness check passed. */
    'ready': boolean;
    /** Human readable explanation of the first failing check. Undefined when `ready` is true. */
    'reason': string | undefined;
}

/**
 * A single named precondition a consuming suite registers to validate before any test is allowed to mutate
 * anything (e.g. "approved tenant is reachable", "required credentials are configured").
 */
export interface ReadinessCheck {
    /** Short human readable name used in diagnostic output to identify which check failed. */
    'name': string;
    /** Executes the check. Return (or resolve to) `true` when ready, `false` when not. Throwing is also treated as a failure. */
    'verify': () => boolean | Promise<boolean>;
}

/**
 * Runs the provided readiness checks in order and stops at the first failure, so callers get a single actionable
 * reason instead of a pile of unrelated failures. Suites should call this once (typically from a file scoped
 * fixture) before any test is allowed to run.
 * @param checks Ordered collection of readiness checks to evaluate before allowing tests to mutate anything.
 * @returns Aggregated readiness result describing whether the environment is safe to run tests against.
 */
export async function evaluateReadiness(checks: readonly ReadinessCheck[]): Promise<EnvironmentReadiness> {
    /*
     * Iterate in order so the first meaningful failure (e.g. missing credentials) is reported before checks that
     * would only make sense once earlier preconditions are satisfied (e.g. tenant reachability).
     */
    for (const check of checks) {
        try {
            /** Whether this individual check reported the environment as ready. */
            const passed = await check.verify();

            if (!passed) {
                return {
                    'ready': false,
                    'reason': `Readiness check '${ check.name }' reported the environment is not ready.`
                };
            }
        } catch (error) {
            /** Human readable message extracted from whatever the check threw. */
            const message = error instanceof Error ? error.message : String(error);

            return {
                'ready': false,
                'reason': `Readiness check '${ check.name }' threw: ${ message }`
            };
        }
    }

    return {
        'ready': true,
        'reason': void 0
    };
}
