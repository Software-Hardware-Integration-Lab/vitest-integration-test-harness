import type { TestAPI } from 'vitest';
import ResourceTracker from '../classes/resourceTracker.js';
import type IntegrationSuiteContext from '../interfaces/integrationSuiteContext.js';
import type IntegrationSuiteOptions from '../interfaces/integrationSuiteOptions.js';
import type IntegrationTestFixtures from '../interfaces/integrationTestFixtures.js';
import { integrationTest } from './integrationTestLifecycle.js';

/**
 * Creates a test API with paired file-scoped setup and cleanup. The setup callback must return cleanup for the
 * shared state it creates; additional shared mutations can be registered immediately through `resources`.
 * @param options File-scoped lifecycle configuration.
 * @returns Vitest test API whose suite lifecycle runs once per test file.
 */
export function integrationSuite(options: IntegrationSuiteOptions): TestAPI<IntegrationTestFixtures> {
    return integrationTest.extend<{
        '$file': {
            'suiteLifecycle': undefined;
        };
    }>({
        'suiteLifecycle': [
            // eslint-disable-next-line no-empty-pattern -- The file-scoped lifecycle has no fixture dependencies.
            async ({ }, use): Promise<void> => {
                const resources = new ResourceTracker(options.name);

                const context: IntegrationSuiteContext = { resources };

                try {
                    const cleanup = await options.setup(context);

                    resources.track(options.name, cleanup);

                    await use(void 0);
                } finally {
                    await resources.cleanupAll();
                }
            },
            {
                'scope': 'file',
                'auto': true
            }
        ]
    });
}
