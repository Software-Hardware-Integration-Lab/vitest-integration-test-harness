import { test as baseTest, type TestContext } from 'vitest';
import DiagnosticsRecorder from './diagnostics.js';
import type { EnvironmentReadiness } from './environment.js';
import ResourceTracker from './resourceTracker.js';

/**
 * Base test function for SHIELD's external integration suites. Provides the shared lifecycle described by
 * LAB-2785: environment readiness validation, resource tracking with guaranteed cleanup, and failure diagnostics.
 *
 * Consuming suites should import this `integrationTest` (instead of importing `test` directly from `vitest`) and, if they
 * need real environment preconditions (tenant reachability, credentials, subscription availability, etc.),
 * extend the generic `environment` fixture rather than redefining the lifecycle.
 * @example
 * ```ts
 * import { test as integrationTest } from '../../Harness/lifecycle.js';
 * import { evaluateReadiness } from '../../Harness/environment.js';
 *
 * export const test = integrationTest.extend('environment', { scope: 'file' }, async () => evaluateReadiness([
 *     { name: 'Approved tenant configured', verify: () => Boolean(process.env['AZURE_TENANT_ID']) }
 * ]));
 * ```
 */
export const integrationTest = baseTest
    /*
     * Generic default: no environment specific preconditions. Suites that need real checks (tenant reachability,
     * credentials, subscription availability, ...) should `.extend('environment', ...)` - see class doc above.
     * File scoped so the (potentially expensive) checks only run once per test file, not once per test.
     */
    .extend('environment', { 'scope': 'file' }, (): EnvironmentReadiness => ({
        'ready': true,
        'reason': void 0
    }))
    // Auto so every test is gated by the environment result even if the test itself doesn't need the fixture.
    .extend('readinessGate', { 'auto': true }, ({ environment, skip }): void => {
        if (!environment.ready) {
            skip(`Integration environment is not ready: ${ environment.reason ?? 'unknown reason' }`);
        }
    })
    // Auto so cleanup is always registered, even for a test that forgets to destructure it.
    .extend('resources', { 'auto': true }, ({ task }, { onCleanup }): ResourceTracker => {
        /** Tracker for this specific test, so cleanup is scoped and never leaks across tests. */
        const tracker = new ResourceTracker(task.name);

        // Guaranteed to run after the test finishes, pass or fail, before the next test starts.
        onCleanup(async () => { await tracker.cleanupAll(); });

        return tracker;
    })
    // Auto so failure diagnostics are captured for every test without suites needing to opt in.
    .extend('diagnostics', { 'auto': true }, ({ onTestFailed, task }): DiagnosticsRecorder => {
        /** Recorder for this specific test, so diagnostic context never leaks across tests. */
        const recorder = new DiagnosticsRecorder(task.name);

        // Runs only after Vitest has recorded the test failure and completed fixture cleanup.
        onTestFailed((context: TestContext) => {
            recorder.flush(context);
        });

        return recorder;
    });
