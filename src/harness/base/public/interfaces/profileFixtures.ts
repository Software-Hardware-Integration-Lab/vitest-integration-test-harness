import type { TestAPI } from 'vitest';
import type IntegrationTestFixtures from './integrationTestFixtures.js';

/**
 * Custom fixture definitions supplied to an environment profile, typed from Vitest's fixture extension API.
 */
export type ProfileFixtures<TFixtures extends object = object> = Parameters<
    TestAPI<IntegrationTestFixtures & TFixtures>['extend']
>[0];
