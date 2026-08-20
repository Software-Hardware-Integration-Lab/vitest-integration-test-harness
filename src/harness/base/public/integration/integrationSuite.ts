import type { TestAPI } from 'vitest';
import type { IntegrationTestFixtures, IntegrationSuiteContext, IntegrationSuiteOptions } from './integrationTypes.js';
import ResourceTracker from '../resource/resourceTracker.js';
import { integrationTest } from './integrationTestLifecycle.js';

function toError(error: unknown): Error {
    return error instanceof Error
        ? error
        : new Error(String(error), { 'cause': error });
}

/**
 * Runs paired file-scoped suite setup and cleanup, preserving whichever failure (setup, cleanup, or both) actually
 * occurred. Extracted from the `suiteLifecycle` fixture so its branches can be unit tested directly.
 * @param options File-scoped lifecycle configuration.
 * @param environmentReady Whether the suite's environment is ready; setup and cleanup are skipped when it is not.
 * @param use Runs the file's tests. Invoked exactly once, regardless of readiness.
 * @throws {Error} The original setup failure, when only setup failed.
 * @throws {Error} The original cleanup failure, when only cleanup failed.
 * @throws {AggregateError} Both failures, when setup and cleanup both failed.
 */
export async function runSuiteLifecycle(
    options: IntegrationSuiteOptions,
    environmentReady: boolean,
    use: () => Promise<void>
): Promise<void> {
    if (!environmentReady) {
        await use();

        return;
    }

    const resources = new ResourceTracker(options.name);

    const context: IntegrationSuiteContext = { resources };

    let lifecycleError: unknown;

    try {
        const cleanup = await options.setup(context);

        resources.assertDeclared();

        resources.registerCleanup(options.name, cleanup);

        await use();
    } catch (error) {
        lifecycleError = error;
    }

    try {
        await resources.cleanupAll();
    } catch (cleanupError) {
        if (lifecycleError !== void 0) {
            const primaryError = toError(lifecycleError);

            throw new AggregateError(
                [primaryError, cleanupError],
                `Integration suite '${ options.name }' failed and cleanup also failed.`,
                { 'cause': cleanupError }
            );
        }

        throw cleanupError;
    }

    if (lifecycleError !== void 0) {
        throw toError(lifecycleError);
    }
}

/**
 * Creates a test API with paired file-scoped setup and cleanup bound to a specific base test runner.
 * @param baseTest Base integration test runner that supplies standard integration test fixtures including readiness gating.
 * @param options File-scoped lifecycle configuration.
 * @returns Vitest test API whose suite lifecycle runs once per test file.
 */
export function createSuiteRunner<TFixtures extends IntegrationTestFixtures>(
    baseTest: TestAPI<TFixtures>,
    options: IntegrationSuiteOptions
): TestAPI<TFixtures> {
    return baseTest.extend<{
        '$file': {
            'suiteLifecycle': undefined;
        };
    }>({
        'suiteLifecycle': [
            async ({ environment }, use): Promise<void> => {
                await runSuiteLifecycle(options, environment.ready, () => use(void 0));
            },
            {
                'scope': 'file',
                'auto': true
            }
        ]
    }) as unknown as TestAPI<TFixtures>;
}

/**
 * Creates a test API with paired file-scoped setup and cleanup using the default `integrationTest` runner.
 * The setup callback must return cleanup for the shared state it creates; additional shared mutations can be
 * registered immediately through `resources`.
 * @param options File-scoped lifecycle configuration.
 * @returns Vitest test API whose suite lifecycle runs once per test file.
 */
export function integrationSuite(options: IntegrationSuiteOptions): TestAPI<IntegrationTestFixtures> {
    return createSuiteRunner(integrationTest, options);
}
