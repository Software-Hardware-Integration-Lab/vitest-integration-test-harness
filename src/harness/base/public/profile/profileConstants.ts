/** Fixture names that profile-specific fixtures cannot override. */
export const reservedProfileFixtureNames = [
    'environment',
    'readinessGate',
    'resources',
    'diagnostics'
] as const;
