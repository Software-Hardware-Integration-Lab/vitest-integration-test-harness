import { test as baseTest, type TestAPI, type TestContext } from 'vitest';
import type { IntegrationTestFixtures } from './integrationTypes.js';
import DiagnosticsRecorder from '../../private/diagnostics/diagnostics.js';
import ResourceTracker from '../resource/resourceTracker.js';

type EnvironmentScope = 'file' | 'test' | 'worker';

function toError(error: unknown): Error {
    return error instanceof Error
        ? error
        : new Error(String(error), { 'cause': error });
}

/**
 * Runs a test body with automatic resource cleanup, preserving whichever failure (test body, cleanup, or both)
 * actually occurred. Extracted from the `resources` fixture so its branches can be unit tested directly.
 * @param taskName Name of the test this lifecycle run belongs to, used for diagnostic output.
 * @param runTestBody Runs the test body with the tracker made available to it.
 * @throws {Error} The original test body failure, when only the test body failed.
 * @throws {Error} The original cleanup failure, when only cleanup failed.
 * @throws {AggregateError} Both failures, when the test body and cleanup both failed.
 */
export async function runResourceTrackingLifecycle(
    taskName: string,
    runTestBody: (tracker: ResourceTracker) => Promise<void>
): Promise<void> {
    const tracker = new ResourceTracker(taskName);

    let testFailed = false;

    let testError: unknown;

    try {
        await runTestBody(tracker);
    } catch (error) {
        testFailed = true;

        testError = error;
    }

    let cleanupError: unknown;

    try {
        await tracker.cleanupAll();
    } catch (error) {
        cleanupError = error;
    }

    if (testFailed && cleanupError !== void 0) {
        throw new AggregateError(
            [toError(testError), cleanupError],
            `Integration test '${ taskName }' failed and cleanup also failed.`,
            { 'cause': cleanupError }
        );
    }

    if (testFailed) {
        throw toError(testError);
    }

    if (cleanupError !== void 0) {
        throw toError(cleanupError);
    }

    tracker.assertDeclared();
}

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
 * @param scope Scope at which the environment readiness fixture is evaluated.
 * @param resolveEnvironment Resolves the readiness result for the configured environment.
 * @returns Integration test API with the requested environment scope and shared harness fixtures.
 */
export function createIntegrationTest(
    scope: EnvironmentScope,
    resolveEnvironment: () => Promise<IntegrationTestFixtures['environment']>
): TestAPI<IntegrationTestFixtures> {
    const fixtures = {
        'environment': [
            // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
            async ({ }, use: (value: IntegrationTestFixtures['environment']) => Promise<void>): Promise<void> => {
                await use(await resolveEnvironment());
            },
            { scope }
        ],
        'readinessGate': [
            async (
                { environment, skip }: IntegrationTestFixtures & {
                    'skip': (reason?: string) => void;
                },
                use: (value: undefined) => Promise<void>
            ): Promise<void> => {
                if (!environment.ready) {
                    skip(`Integration environment is not ready: ${ environment.reason ?? 'unknown reason' }`);
                }

                await use(void 0);
            },
            { 'auto': true }
        ],
        'resources': [
            async ({ task }: IntegrationTestFixtures & { 'task': { 'name': string } }, use: (value: ResourceTracker) => Promise<void>): Promise<void> => {
                await runResourceTrackingLifecycle(task.name, (tracker) => use(tracker));
            },
            { 'auto': true }
        ],
        'diagnostics': [
            async (
                { onTestFailed, task }: IntegrationTestFixtures & {
                    'onTestFailed': (callback: (context: TestContext) => void) => void;
                    'task': { 'name': string };
                },
                use: (value: IntegrationTestFixtures['diagnostics']) => Promise<void>
            ): Promise<void> => {
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
    };

    return baseTest.extend<IntegrationTestFixtures>(fixtures as never) as TestAPI<IntegrationTestFixtures>;
}

export const integrationTest = createIntegrationTest(
    'file',
    (): Promise<IntegrationTestFixtures['environment']> => Promise.resolve({
        'ready': true,
        'reason': void 0
    })
);
