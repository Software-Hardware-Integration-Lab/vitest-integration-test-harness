import type { TestAPI } from 'vitest';
import type EnvironmentProfile from '../interfaces/environmentProfile.js';
import type EnvironmentProfileResult from '../interfaces/environmentProfileResult.js';
import type EnvironmentReadiness from '../interfaces/environmentReadiness.js';
import type IntegrationSuiteOptions from '../interfaces/integrationSuiteOptions.js';
import type IntegrationTestFixtures from '../interfaces/integrationTestFixtures.js';
import { evaluateEnvironmentVariables, evaluateReadiness } from './environment.js';
import { createSuiteRunner } from './integrationSuite.js';
import { integrationTest } from './integrationTestLifecycle.js';

/**
 * Creates an integration environment profile test API and suite runner preconfigured with
 * environment variable schemas, ordered readiness checks, and optional custom fixtures.
 * @param profile Profile configuration and metadata.
 * @returns Configured `test` and `suite` functions along with a shallow-frozen `profile` metadata snapshot.
 */
export function createEnvironmentProfile<TFixtures extends object = object>(profile: EnvironmentProfile<TFixtures>): EnvironmentProfileResult<TFixtures> {
    type EnvironmentFixtures = IntegrationTestFixtures & TFixtures;

    const profileSnapshot = Object.freeze({ ...profile });

    let profileTest = integrationTest.extend<{
        '$file': {
            'environment': EnvironmentReadiness;
        };
    }>({
        'environment': [
            // eslint-disable-next-line no-empty-pattern -- Vitest fixture destructuring requirement
            async ({ }, use): Promise<void> => {
                const envReadiness = evaluateEnvironmentVariables(profile.requiredEnvironmentVariables);

                if (!envReadiness.ready) {
                    await use(envReadiness);

                    return;
                }

                if (profile.readinessChecks.length > 0) {
                    const checksReadiness = await evaluateReadiness(profile.readinessChecks);

                    await use(checksReadiness);

                    return;
                }

                await use({
                    'ready': true,
                    'reason': void 0
                });
            },
            { 'scope': 'file' }
        ]
    }) as unknown as TestAPI<EnvironmentFixtures>;

    if (profile.fixtures) {
        profileTest = profileTest.extend(profile.fixtures) as unknown as TestAPI<EnvironmentFixtures>;
    }

    return {
        'test': profileTest,
        'suite': (options: IntegrationSuiteOptions): TestAPI<EnvironmentFixtures> => createSuiteRunner(profileTest, options),
        'profile': profileSnapshot
    };
}
