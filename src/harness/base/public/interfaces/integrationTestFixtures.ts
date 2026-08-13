import type ResourceTracker from '../classes/resourceTracker.js';
import type EnvironmentReadiness from './environmentReadiness.js';
import type Diagnostics from './diagnostics.js';

/**
 * Fixtures provided by the `integrationTest` base test function. Suites that extend the base test with additional
 * fixtures should extend this interface to include their own fixtures.
 */
export default interface IntegrationTestFixtures {
    /** Environment readiness result used by the automatic readiness gate. */
    'environment': EnvironmentReadiness;
    /** Automatic gate fixture; it has no exposed value and skips tests when the environment is not ready. */
    'readinessGate': undefined;
    /** Per-test tracker used to register resources for guaranteed LIFO cleanup. */
    'resources': ResourceTracker;
    /** Per-test recorder used to capture context that is printed only after a test failure. */
    'diagnostics': Diagnostics;
}
