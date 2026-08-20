import type { TestAPI } from 'vitest';
import type {
    EnvironmentReadiness
} from '../environment/environmentTypes.js';
import type { IntegrationSuiteOptions, IntegrationTestFixtures } from '../integration/integrationTypes.js';
import type { EnvironmentProfile, EnvironmentProfileResult } from './profileTypes.js';
import deepFreeze from '../../../../utilities/private/deepFreeze.js';
import { evaluateEnvironmentVariables } from '../environment/evaluateEnvironmentVariables.js';
import { evaluateReadiness } from '../environment/evaluateReadiness.js';
import { createSuiteRunner } from '../integration/integrationSuite.js';
import { createIntegrationTest } from '../integration/integrationTestLifecycle.js';
import { reservedProfileFixtureNames } from './profileConstants.js';

const reservedFixtureNames = new Set<string>(reservedProfileFixtureNames);

function assertNoReservedFixtureNames(fixtures: object | undefined): void {
    const reservedFixtureName = Object.keys(fixtures ?? {}).find((fixtureName) => reservedFixtureNames.has(fixtureName));

    if (reservedFixtureName) {
        throw new Error(`Profile fixtures cannot override the reserved '${ reservedFixtureName }' fixture.`);
    }
}

/**
 * Creates an integration environment profile test API and suite runner preconfigured with
 * environment variable schemas, ordered readiness checks, and optional custom fixtures.
 * @param profile Profile configuration and metadata.
 * @returns Configured `integrationTest` and `integrationSuite` functions along with a frozen `profile` metadata snapshot. Fixture
 * definitions retain their original mutable reference because Vitest annotates them during extension.
 */
export function createEnvironmentProfile<TFixtures extends object = object>(profile: EnvironmentProfile<TFixtures>): EnvironmentProfileResult<TFixtures> {
    type EnvironmentFixtures = IntegrationTestFixtures & TFixtures;

    assertNoReservedFixtureNames(profile.fixtures);

    const { fixtures, ...profileMetadata } = profile;

    const profileSnapshot = Object.freeze({
        ...deepFreeze({
            ...profileMetadata,
            'readinessChecks': profile.readinessChecks.map((check) => ({ ...check })),
            'requiredEnvironmentVariables': profile.requiredEnvironmentVariables?.map((variable) => ({ ...variable })),
            'tags': profile.tags ? [...profile.tags] : void 0
        }),
        fixtures
    });

    async function resolveEnvironment(): Promise<EnvironmentReadiness> {
        const envReadiness = evaluateEnvironmentVariables(profileSnapshot.requiredEnvironmentVariables);

        if (!envReadiness.ready) {
            return envReadiness;
        }

        if (profileSnapshot.readinessChecks.length > 0) {
            return evaluateReadiness(profileSnapshot.readinessChecks);
        }

        return {
            'ready': true,
            'reason': void 0
        };
    }

    let profileTest = createIntegrationTest(profileSnapshot.scope ?? 'file', resolveEnvironment) as unknown as TestAPI<EnvironmentFixtures>;

    if (profile.fixtures) {
        profileTest = profileTest.extend(profile.fixtures) as unknown as TestAPI<EnvironmentFixtures>;
    }

    return {
        'integrationTest': profileTest,
        'integrationSuite': (options: IntegrationSuiteOptions): TestAPI<EnvironmentFixtures> => createSuiteRunner(profileTest, options),
        'profile': profileSnapshot
    };
}
