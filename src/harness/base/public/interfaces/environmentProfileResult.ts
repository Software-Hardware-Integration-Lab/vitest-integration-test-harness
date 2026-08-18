import type { TestAPI } from 'vitest';
import type IntegrationTestFixtures from './integrationTestFixtures.js';
import type IntegrationSuiteOptions from './integrationSuiteOptions.js';
import type EnvironmentProfile from './environmentProfile.js';

/**
 * Result returned by `createEnvironmentProfile` containing preconfigured test and suite APIs and profile metadata.
 */
export default interface EnvironmentProfileResult<TFixtures extends object = object> {
    /** Configured test API with profile readiness and custom fixtures. */
    'test': TestAPI<IntegrationTestFixtures & TFixtures>;
    /** Suite factory creating file-scoped lifecycles with profile readiness and custom fixtures. */
    'suite': (options: IntegrationSuiteOptions) => TestAPI<IntegrationTestFixtures & TFixtures>;
    /** Readonly metadata and configuration of the profile. */
    'profile': Readonly<EnvironmentProfile<TFixtures>>;
}
