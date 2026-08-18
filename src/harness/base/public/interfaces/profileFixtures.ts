import type { TestAPI } from 'vitest';
import type IntegrationTestFixtures from './integrationTestFixtures.js';

/** Fixture names that profile-specific fixtures cannot override. */
export const reservedProfileFixtureNames = [
    'environment',
    'readinessGate',
    'resources',
    'diagnostics'
] as const;

type ReservedProfileFixtureName = typeof reservedProfileFixtureNames[number];

/**
 * Custom fixture definitions supplied to an environment profile, typed from Vitest's fixture extension API.
 */
export type ProfileFixtures<TFixtures extends object = object> = Extract<keyof TFixtures, ReservedProfileFixtureName> extends never
    ? Parameters<TestAPI<IntegrationTestFixtures & TFixtures>['extend']>[0]
    : never;
