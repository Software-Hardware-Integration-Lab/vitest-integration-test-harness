import type { TestAPI } from 'vitest';
import ResourceTracker from '../classes/resourceTracker.js';
import type EnvironmentReadiness from '../interfaces/environmentReadiness.js';
import type IntegrationSuiteContext from '../interfaces/integrationSuiteContext.js';
import type IntegrationSuiteOptions from '../interfaces/integrationSuiteOptions.js';
import type IntegrationTestFixtures from '../interfaces/integrationTestFixtures.js';
import { integrationTest } from './integrationTestLifecycle.js';

function toError(error: unknown): Error {
    return error instanceof Error
        ? error
        : new Error(String(error), { 'cause': error });
}

/**
 * Creates a test API with paired file-scoped setup and cleanup bound to a specific base test runner.
 * @param baseTest Base test runner that supplies at least an `environment` readiness fixture.
 * @param options File-scoped lifecycle configuration.
 * @returns Vitest test API whose suite lifecycle runs once per test file.
 */
export function createSuiteRunner<TFixtures extends { 'environment': EnvironmentReadiness }>(
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
                if (!environment.ready) {
                    await use(void 0);

                    return;
                }

                const resources = new ResourceTracker(options.name);

                const context: IntegrationSuiteContext = { resources };

                let lifecycleError: unknown;

                try {
                    const cleanup = await options.setup(context);

                    resources.track(options.name, cleanup);

                    await use(void 0);
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
