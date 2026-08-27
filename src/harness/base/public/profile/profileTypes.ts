import type { TestAPI } from 'vitest';
import type { ReadinessCheck, TestableEnvironmentVariable } from '../environment/environmentTypes.js';
import type { IntegrationSuiteOptions, IntegrationTestFixtures } from '../integration/integrationTypes.js';
import { reservedProfileFixtureNames } from './profileConstants.js';

type ReservedProfileFixtureName = typeof reservedProfileFixtureNames[number];

/**
 * Custom fixture definitions supplied to an environment profile, typed from Vitest's fixture extension API.
 */
export type ProfileFixtures<TFixtures extends object = object> = Extract<keyof TFixtures, ReservedProfileFixtureName> extends never
    ? Parameters<TestAPI<IntegrationTestFixtures & TFixtures>['extend']>[0]
    : never;

/**
 * Extensible neutral dependency classification categories for environment profiles.
 */
export type DependencyType =
    'Database' |
    'InternalApi' |
    'ExternalApi' |
    'MessageQueue' |
    'BlobStorage' |
    'Cache' |
    'FileSystem' |
    'AuthenticationProvider' |
    'IdentityProvider' |
    'EmailService' |
    'NotificationService' |
    'SearchService' |
    'ConfigurationProvider' |
    'ThirdPartyService' |
    (string & {});

/**
 * Risk is related to how dependency setup and
 * teardown can affect other tests.
 */
export type RiskLevel =
    'Blocking' |
    'Important' |
    'Optional' |
    (string & {});

/**
 * Generic provider-agnostic integration environment profile configuration.
 */
export interface EnvironmentProfile<TFixtures extends object = object> {
    /** Unique human-readable profile name. */
    'name': string;
    /** Neutral dependency category metadata. */
    'dependencyType': DependencyType;
    /** Neutral risk level metadata. */
    'riskLevel': RiskLevel;
    /** Ordered readiness checks to evaluate before allowing tests to run. */
    'readinessChecks': readonly ReadinessCheck[];
    /** Opt-in required environment variable names evaluated before readiness checks. */
    'requiredEnvironmentVariables'?: readonly TestableEnvironmentVariable[];
    /** Custom fixtures to extend the test context. Vitest may annotate these definitions during extension. */
    'fixtures'?: ProfileFixtures<TFixtures>;
    /** Consumer-defined classification tags. */
    'tags'?: readonly string[];
    /** Optional scope for the profile's fixtures. Defaults to `file` scope. */
    'scope'?: 'file' | 'test' | 'worker';
}

/**
 * Result returned by `createEnvironmentProfile` containing preconfigured integration test and suite APIs and profile metadata.
 */
export interface EnvironmentProfileResult<TFixtures extends object = object> {
    /** Configured integration test API with profile readiness and custom fixtures. */
    'integrationTest': TestAPI<IntegrationTestFixtures & TFixtures>;
    /** Integration suite factory creating file-scoped lifecycles with profile readiness and custom fixtures. */
    'integrationSuite': (options: IntegrationSuiteOptions) => TestAPI<IntegrationTestFixtures & TFixtures>;
    /**
     * Readonly profile metadata snapshot. Fixture definitions retain their original mutable reference because Vitest
     * annotates them while extending the test API.
     */
    'profile': Readonly<EnvironmentProfile<TFixtures>>;
}
