import { test as baseTest, type TestContext } from 'vitest';
import type IntegrationTestFixtures from '../interfaces/integrationTestFixtures.js';
import DiagnosticsRecorder from '../../private/classes/diagnostics.js';
import ResourceTracker from '../classes/resourceTracker.js';

/**
 * Base test function for external test integration suites. Provides the shared lifecycle
 * with environment readiness validation, resource tracking with guaranteed cleanup, and failure diagnostics.
 *
 * Consuming suites should import this `integrationTest` instead of importing `test` directly from `vitest`. Suites
 * needing environment preconditions should override the generic `environment` fixture rather than redefining the
 * shared lifecycle.
 * @example
 * ```ts
 * import { integrationTest, evaluateReadiness } from '@software-hardware-integration-lab/vitest-integration-test-harness';
 *
 * export const test = integrationTest.extend({
 *     'environment': [
 *         async ({ }, use): Promise<void> => {
 *             await use(await evaluateReadiness([
 *                 {
 *                     'name': 'Approved tenant configured',
 *                     'verify': () => Boolean(process.env['AZURE_TENANT_ID'])
 *                 }
 *             ]));
 *         },
 *         { 'scope': 'file' }
 *     ]
 * });
 * ```
 */
export const integrationTest = baseTest.extend<IntegrationTestFixtures>({
    'environment': [
        // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
        async ({ }, use): Promise<void> => {
            await use({
                'ready': true,
                'reason': void 0
            });
        },
        { 'scope': 'file' }
    ],
    'readinessGate': [
        async ({ environment, skip }, use): Promise<void> => {
            if (!environment.ready) {
                skip(`Integration environment is not ready: ${ environment.reason ?? 'unknown reason' }`);
            }

            await use(void 0);
        },
        { 'auto': true }
    ],
    'resources': [
        async ({ task }, use): Promise<void> => {
            const tracker = new ResourceTracker(task.name);

            try {
                await use(tracker);
            } finally {
                await tracker.cleanupAll();
            }
        },
        { 'auto': true }
    ],
    'diagnostics': [
        async ({ onTestFailed, task }, use): Promise<void> => {
            /** Recorder for this specific test, so diagnostic context never leaks across tests. */
            const recorder = new DiagnosticsRecorder(task.name);

            // Runs only after Vitest has recorded the test failure and completed fixture cleanup.
            onTestFailed((context: TestContext) => {
                recorder.flush(context);
            });

            await use(recorder);
        },
        { 'auto': true }
    ]

});
