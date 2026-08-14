/**
 * A single named precondition a consuming suite registers to validate before any test is allowed to mutate
 * anything (e.g. "approved tenant is reachable", "required credentials are configured").
 */
export default interface ReadinessCheck {
    /** Short human readable name used in diagnostic output to identify which check failed. */
    'name': string;
    /** Executes the check. Return (or resolve to) `true` when ready, `false` when not. Throwing is also treated as a failure. */
    'verify': () => boolean | Promise<boolean>;
}
