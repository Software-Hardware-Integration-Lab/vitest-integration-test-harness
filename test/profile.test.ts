import { afterAll, describe, expect, it, vi } from 'vitest';
import {
    createEnvironmentProfile,
    evaluateEnvironmentVariables,
    evaluateReadiness,
    type DependencyType,
    type EnvironmentProfile,
    type EnvironmentProfileResult,
    type EnvironmentVariableCheckResult,
    type RiskLevel,
    type TestableEnvironmentVariable
} from '../src/index.js';

void describe('evaluateEnvironmentVariables', () => {
    it('reports ready when required variables list is undefined or empty', () => {
        const undefinedResult = evaluateEnvironmentVariables(void 0, {});

        expect(undefinedResult).toEqual({
            'ready': true,
            'reason': void 0
        });

        const emptyArrayResult = evaluateEnvironmentVariables([], {});

        expect(emptyArrayResult).toEqual({
            'ready': true,
            'reason': void 0
        });
    });

    it('reports ready when all required variables are present', () => {
        const result = evaluateEnvironmentVariables(
            [{ 'key': 'TEST_VAR_A' }, { 'key': 'TEST_VAR_B' }],
            {
                'TEST_VAR_A': 'val-a',
                'TEST_VAR_B': 'val-b'
            }
        );

        expect(result).toEqual({
            'ready': true,
            'reason': void 0
        });
    });

    it('reports ready when custom check function passes with success object', () => {
        const customCheckSpy = vi.fn(() => ({
            'success': true,
            'reason': 'Port is valid'
        }));

        const result = evaluateEnvironmentVariables(
            [
                {
                    'key': 'PORT',
                    'check': customCheckSpy
                }
            ],
            { 'PORT': '8080' }
        );

        expect(customCheckSpy).toHaveBeenCalledWith('8080');

        expect(result).toEqual({
            'ready': true,
            'reason': void 0
        });
    });

    it('passes the environment variable value to the check function for validation logic', () => {
        const checkFn = vi.fn((value: string): EnvironmentVariableCheckResult => ({
            'success': Number(value) >= 1000 && Number(value) <= 9000,
            'reason': 'Port must be between 1000 and 9000'
        }));

        const validResult = evaluateEnvironmentVariables(
            [
                {
                    'key': 'APP_PORT',
                    'check': checkFn
                }
            ],
            { 'APP_PORT': '3000' }
        );

        expect(checkFn).toHaveBeenCalledWith('3000');

        expect(validResult.ready).toBe(true);

        const invalidResult = evaluateEnvironmentVariables(
            [
                {
                    'key': 'APP_PORT',
                    'check': checkFn
                }
            ],
            { 'APP_PORT': '9999' }
        );

        expect(checkFn).toHaveBeenCalledWith('9999');

        expect(invalidResult.ready).toBe(false);

        expect(invalidResult.reason).toBe('APP_PORT: Port must be between 1000 and 9000');
    });

    it('reports unready with custom reason when custom check function returns an object with success: false', () => {
        const customCheckSpy = vi.fn(() => ({
            'success': false,
            'reason': 'Must be a valid port between 1 and 65535'
        }));

        const result = evaluateEnvironmentVariables(
            [
                {
                    'key': 'PORT',
                    'check': customCheckSpy
                }
            ],
            { 'PORT': '999999' }
        );

        expect(customCheckSpy).toHaveBeenCalled();

        expect(result.ready).toBe(false);

        expect(result.reason).toBe('PORT: Must be a valid port between 1 and 65535');
    });

    it('reports unready when custom check function returns object with success: false without reason', () => {
        const customCheckSpy = vi.fn(() => ({
            'success': false
        }));

        const result = evaluateEnvironmentVariables(
            [
                {
                    'key': 'PORT',
                    'check': customCheckSpy
                }
            ],
            { 'PORT': 'invalid' }
        );

        expect(result.ready).toBe(false);

        expect(result.reason).toBe('PORT: Validation check failed');
    });

    it('reports ready when custom check function passes with success object without reason', () => {
        const customCheckSpy = vi.fn(() => ({
            'success': true
        }));

        const result = evaluateEnvironmentVariables(
            [
                {
                    'key': 'PORT',
                    'check': customCheckSpy
                }
            ],
            { 'PORT': '8080' }
        );

        expect(customCheckSpy).toHaveBeenCalled();

        expect(result).toEqual({
            'ready': true,
            'reason': void 0
        });
    });

    it('reports unready when custom check function throws a non-Error value', () => {
        function throwingStringCheck(): EnvironmentVariableCheckResult {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- Verifying non-Error thrown error handling
            throw 'Primitive error string';
        }

        const result = evaluateEnvironmentVariables(
            [
                {
                    'key': 'API_KEY',
                    'check': throwingStringCheck
                }
            ],
            { 'API_KEY': 'some-key' }
        );

        expect(result.ready).toBe(false);

        expect(result.reason).toBe('API_KEY: Primitive error string');
    });

    it('reports unready when custom check function throws an error', () => {
        function throwingCheck(): EnvironmentVariableCheckResult {
            throw new Error('Check error');
        }

        const result = evaluateEnvironmentVariables(
            [
                {
                    'key': 'API_KEY',
                    'check': throwingCheck
                }
            ],
            { 'API_KEY': 'some-key' }
        );

        expect(result.ready).toBe(false);

        expect(result.reason).toBe('API_KEY: Check error');
    });

    it('reports unready and does not call custom check when variable is missing', () => {
        const customCheckSpy = vi.fn<() => EnvironmentVariableCheckResult>(() => ({
            'success': true
        }));

        const result = evaluateEnvironmentVariables(
            [
                {
                    'key': 'MISSING_KEY',
                    'check': customCheckSpy
                }
            ],
            {}
        );

        expect(customCheckSpy).not.toHaveBeenCalled();

        expect(result.ready).toBe(false);

        expect(result.reason).toBe('MISSING_KEY: Variable is not set');
    });

    it('reports unready and does not call custom check when variable is empty or whitespace', () => {
        const customCheckSpy = vi.fn<() => EnvironmentVariableCheckResult>(() => ({
            'success': true
        }));

        const result = evaluateEnvironmentVariables(
            [
                {
                    'key': 'EMPTY_KEY',
                    'check': customCheckSpy
                }
            ],
            { 'EMPTY_KEY': '   ' }
        );

        expect(customCheckSpy).not.toHaveBeenCalled();

        expect(result.ready).toBe(false);

        expect(result.reason).toBe('EMPTY_KEY: Variable is empty');
    });

    it('aggregates multiple missing variables into a formatted list: "ENV_VAR: REASON_OF_FAIL"', () => {
        const result = evaluateEnvironmentVariables(
            [
                { 'key': 'MISSING_VAR_ONE' },
                { 'key': 'PRESENT_VAR' },
                { 'key': 'MISSING_VAR_TWO' }
            ],
            {
                'PRESENT_VAR': 'present'
            }
        );

        expect(result.ready).toBe(false);

        expect(result.reason).toBe('MISSING_VAR_ONE: Variable is not set, MISSING_VAR_TWO: Variable is not set');
    });

    it('treats empty or whitespace-only variables as empty when no custom check is provided', () => {
        const result = evaluateEnvironmentVariables(
            [{ 'key': 'EMPTY_VAR' }, { 'key': 'WHITESPACE_VAR' }],
            {
                'EMPTY_VAR': '',
                'WHITESPACE_VAR': '   '
            }
        );

        expect(result.ready).toBe(false);

        expect(result.reason).toBe('EMPTY_VAR: Variable is empty, WHITESPACE_VAR: Variable is empty');
    });

    it('formats multiple failures with distinct reasons in a list', () => {
        const result = evaluateEnvironmentVariables(
            [
                { 'key': 'VAR_NOT_SET' },
                { 'key': 'VAR_EMPTY' },
                {
                    'key': 'VAR_CHECK_FALSE',
                    'check': (): EnvironmentVariableCheckResult => ({
                        'success': false
                    })
                },
                {
                    'key': 'VAR_CHECK_OBJ',
                    'check': (): EnvironmentVariableCheckResult => ({
                        'success': false,
                        'reason': 'Must start with https://'
                    })
                },
                {
                    'key': 'VAR_CHECK_THROW',
                    'check': (): EnvironmentVariableCheckResult => {
                        throw new Error('Connection refused');
                    }
                },
                {
                    'key': 'VAR_OK',
                    'check': (): EnvironmentVariableCheckResult => ({
                        'success': true
                    })
                }
            ],
            {
                'VAR_EMPTY': '   ',
                'VAR_CHECK_FALSE': 'value1',
                'VAR_CHECK_OBJ': 'http://insecure.com',
                'VAR_CHECK_THROW': 'value3',
                'VAR_OK': 'valid-value'
            }
        );

        expect(result.ready).toBe(false);

        const expectedReason = 'VAR_NOT_SET: Variable is not set, ' +
            'VAR_EMPTY: Variable is empty, ' +
            'VAR_CHECK_FALSE: Validation check failed, ' +
            'VAR_CHECK_OBJ: Must start with https://, ' +
            'VAR_CHECK_THROW: Connection refused';

        expect(result.reason).toBe(expectedReason);
    });

    it('uses process.env by default when env argument is omitted', () => {
        const originalValue = process.env['TEST_PROFILE_DUMMY_VAR_NONEXISTENT'];

        try {
            delete process.env['TEST_PROFILE_DUMMY_VAR_NONEXISTENT'];

            const result = evaluateEnvironmentVariables([{ 'key': 'TEST_PROFILE_DUMMY_VAR_NONEXISTENT' }]);

            expect(result.ready).toBe(false);

            expect(result.reason).toBe('TEST_PROFILE_DUMMY_VAR_NONEXISTENT: Variable is not set');
        } finally {
            if (originalValue !== void 0) {
                process.env['TEST_PROFILE_DUMMY_VAR_NONEXISTENT'] = originalValue;
            }
        }
    });
});

void describe('evaluateReadiness', () => {
    it('reports ready when all readiness checks pass', async () => {
        const result = await evaluateReadiness([
            {
                'name': 'check-1',
                'verify': (): boolean => true
            },
            {
                'name': 'check-2',
                'verify': (): boolean => true
            }
        ]);

        expect(result).toEqual({
            'ready': true,
            'reason': void 0
        });
    });

    it('reports unready when a check returns false', async () => {
        const result = await evaluateReadiness([
            {
                'name': 'failing-check',
                'verify': (): boolean => false
            }
        ]);

        expect(result).toEqual({
            'ready': false,
            'reason': 'Readiness check \'failing-check\' reported the environment is not ready.'
        });
    });

    it('reports unready when a check throws an Error', async () => {
        const result = await evaluateReadiness([
            {
                'name': 'error-check',
                'verify': (): boolean => {
                    throw new Error('Database unreachable');
                }
            }
        ]);

        expect(result).toEqual({
            'ready': false,
            'reason': 'Readiness check \'error-check\' threw: Database unreachable'
        });
    });

    it('reports unready when a check throws a non-Error primitive', async () => {
        const result = await evaluateReadiness([
            {
                'name': 'primitive-check',
                'verify': (): boolean => {
                    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Verifying non-Error thrown error handling
                    throw 'Socket closed';
                }
            }
        ]);

        expect(result).toEqual({
            'ready': false,
            'reason': 'Readiness check \'primitive-check\' threw: Socket closed'
        });
    });
});

void describe('createEnvironmentProfile', () => {
    it('returns integrationTest, integrationSuite, and immutable profile metadata', () => {
        const profileDefinition: EnvironmentProfile = {
            'name': 'database-integration',
            'dependencyType': 'Database',
            'riskLevel': 'Important',
            'readinessChecks': [],
            'tags': ['postgres', 'read-write']
        };

        const result = createEnvironmentProfile(profileDefinition);

        expect(typeof result.integrationTest).toBe('function');

        expect(typeof result.integrationSuite).toBe('function');

        expect(result.profile.name).toBe('database-integration');

        expect(result.profile.dependencyType).toBe('Database');

        expect(result.profile.riskLevel).toBe('Important');

        expect(result.profile.readinessChecks).toEqual([]);

        expect(result.profile.tags).toEqual(['postgres', 'read-write']);
    });

    it('supports custom extensible dependency types and risk levels', () => {
        const customProfile = createEnvironmentProfile({
            'name': 'custom-service',
            'dependencyType': 'special-hardware',
            'riskLevel': 'isolated-sandbox',
            'readinessChecks': []
        });

        expect(customProfile.profile.dependencyType).toBe('special-hardware');

        expect(customProfile.profile.riskLevel).toBe('isolated-sandbox');
    });

    it('freezes the profile metadata object', () => {
        const profileDefinition: EnvironmentProfile = {
            'name': 'immutable-profile',
            'dependencyType': 'Database',
            'riskLevel': 'Optional',
            'readinessChecks': []
        };

        const result = createEnvironmentProfile(profileDefinition);

        expect(Object.isFrozen(result.profile)).toBe(true);
    });

    it('rejects fixtures that override core lifecycle fixtures', () => {
        expect(() => createEnvironmentProfile({
            'name': 'unsafe-fixture-profile',
            'dependencyType': 'Database',
            'riskLevel': 'Optional',
            'readinessChecks': [],
            'fixtures': {
                'environment': void 0
            } as never
        })).toThrow('Profile fixtures cannot override the reserved \'environment\' fixture.');
    });

    it('creates a frozen metadata snapshot without freezing caller-owned collections', () => {
        const requiredVariable: TestableEnvironmentVariable = { 'key': 'API_KEY' };

        const readinessCheck = {
            'name': 'ready',
            'verify': (): boolean => true
        };

        const readinessChecks = [readinessCheck];

        const requiredEnvironmentVariables = [requiredVariable];

        const tags = ['database'];

        const profileDefinition: EnvironmentProfile = {
            'name': 'isolated-profile',
            'dependencyType': 'Database',
            'riskLevel': 'Optional',
            readinessChecks,
            requiredEnvironmentVariables,
            tags
        };

        const result = createEnvironmentProfile(profileDefinition);

        expect(Object.isFrozen(profileDefinition.readinessChecks)).toBe(false);

        expect(Object.isFrozen(readinessCheck)).toBe(false);

        expect(Object.isFrozen(profileDefinition.requiredEnvironmentVariables)).toBe(false);

        expect(Object.isFrozen(requiredVariable)).toBe(false);

        expect(Object.isFrozen(profileDefinition.tags)).toBe(false);

        expect(Object.isFrozen(result.profile.readinessChecks)).toBe(true);

        expect(Object.isFrozen(result.profile.readinessChecks[0])).toBe(true);

        expect(Object.isFrozen(result.profile.requiredEnvironmentVariables)).toBe(true);

        expect(Object.isFrozen(result.profile.requiredEnvironmentVariables?.[0])).toBe(true);

        expect(Object.isFrozen(result.profile.tags)).toBe(true);

        readinessChecks.push({
            'name': 'mutated',
            'verify': (): boolean => false
        });

        requiredEnvironmentVariables.push({ 'key': 'MUTATED_KEY' });

        tags.push('mutated');

        expect(result.profile.readinessChecks).toHaveLength(1);

        expect(result.profile.requiredEnvironmentVariables).toHaveLength(1);

        expect(result.profile.tags).toEqual(['database']);
    });

    it('verifies typescript type exports and contracts', () => {
        const dependency: DependencyType = 'ExternalApi';

        const risk: RiskLevel = 'Blocking';

        const objectCheckResult: EnvironmentVariableCheckResult = {
            'success': false,
            'reason': 'Custom reason'
        };

        const testableEnvVarWithObject: TestableEnvironmentVariable = {
            'key': 'API_SECRET',
            'check': (): EnvironmentVariableCheckResult => objectCheckResult
        };

        const profile: EnvironmentProfile = {
            'name': 'contract-test',
            'dependencyType': dependency,
            'riskLevel': risk,
            'readinessChecks': [],
            'requiredEnvironmentVariables': [testableEnvVarWithObject]
        };

        const result: EnvironmentProfileResult = createEnvironmentProfile(profile);

        expect(result.profile.dependencyType).toBe('ExternalApi');

        expect(result.profile.riskLevel).toBe('Blocking');

        expect(result.profile.requiredEnvironmentVariables).toEqual([testableEnvVarWithObject]);
    });
});

const readyLifecycleProfile = createEnvironmentProfile<{
    'customGreeting': string;
}>({
    'name': 'ready-sample-profile',
    'dependencyType': 'InternalApi',
    'riskLevel': 'Optional',
    'readinessChecks': [
        {
            'name': 'always-ready-check',
            'verify': (): boolean => true
        }
    ],
    'fixtures': {
        'customGreeting': [
            // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
            async ({ }, use: (greeting: string) => Promise<void>): Promise<void> => {
                await use('hello-from-profile');
            },
            { 'scope': 'test' }
        ]
    }
});

readyLifecycleProfile.integrationTest('executes test and provides custom fixtures and resource tracking', ({
    customGreeting,
    resources,
    diagnostics
}) => {
    expect(customGreeting).toBe('hello-from-profile');

    resources.markNoResources();

    expect(typeof diagnostics.record).toBe('function');
});

const suiteOrder: string[] = [];

const profileSuiteTest = readyLifecycleProfile.integrationSuite({
    'name': 'profile-suite-sample',
    'setup': async ({ resources }): Promise<() => void> => {
        suiteOrder.push('profile-suite-setup');

        await resources.track('suite-resource', (): Promise<object> => Promise.resolve({}), () => {
            suiteOrder.push('profile-suite-cleanup');
        });

        return (): void => {
            suiteOrder.push('profile-suite-paired-cleanup');
        };
    }
});

profileSuiteTest('runs profile suite lifecycle with custom fixtures', ({ customGreeting, resources }) => {
    resources.markNoResources();

    expect(customGreeting).toBe('hello-from-profile');

    expect(suiteOrder).toEqual(['profile-suite-setup']);
});

let missingVariableReadinessCheckCallCount = 0;

function missingVariableReadinessCheck(): boolean {
    missingVariableReadinessCheckCallCount += 1;

    return true;
}

const unreadyProfileWithChecks = createEnvironmentProfile({
    'name': 'missing-vars-profile',
    'dependencyType': 'InternalApi',
    'riskLevel': 'Blocking',
    'requiredEnvironmentVariables': [{ 'key': 'NON_EXISTENT_VAR_123456' }],
    'readinessChecks': [
        {
            'name': 'unreachable-check',
            'verify': missingVariableReadinessCheck
        }
    ]
});

unreadyProfileWithChecks.integrationTest('skips test when required environment variables are missing', () => {
    expect.unreachable('Test should be skipped by readinessGate due to missing env vars');
});

afterAll(() => {
    expect(missingVariableReadinessCheckCallCount).toBe(0);
});

const unreadyCheckProfile = createEnvironmentProfile({
    'name': 'failing-check-profile',
    'dependencyType': 'MessageQueue',
    'riskLevel': 'Important',
    'readinessChecks': [
        {
            'name': 'failing-readiness-check',
            'verify': (): boolean => false
        }
    ]
});

unreadyCheckProfile.integrationTest('skips test when readiness check fails', () => {
    expect.unreachable('Test should be skipped by readinessGate due to failing check');
});

const throwingCheckProfile = createEnvironmentProfile({
    'name': 'throwing-check-profile',
    'dependencyType': 'ExternalApi',
    'riskLevel': 'Blocking',
    'readinessChecks': [
        {
            'name': 'throwing-readiness-check',
            'verify': (): boolean => {
                throw new Error('Connection refused to mock service');
            }
        }
    ]
});

throwingCheckProfile.integrationTest('skips test when readiness check throws an error', () => {
    expect.unreachable('Test should be skipped by readinessGate due to throwing check');
});

const minimalProfile = createEnvironmentProfile({
    'name': 'minimal-default-profile',
    'dependencyType': 'ConfigurationProvider',
    'riskLevel': 'Optional',
    'readinessChecks': []
});

minimalProfile.integrationTest('runs successfully with minimal profile configuration', ({ environment, resources }) => {
    resources.markNoResources();

    expect(environment.ready).toBe(true);

    expect(environment.reason).toBeUndefined();
});

const unreadySuiteSetupSpy = vi.fn();

const unreadySuiteProfile = createEnvironmentProfile({
    'name': 'unready-suite-profile',
    'dependencyType': 'Database',
    'riskLevel': 'Blocking',
    'readinessChecks': [
        {
            'name': 'always-unready',
            'verify': (): boolean => false
        }
    ]
});

const unreadySuiteTest = unreadySuiteProfile.integrationSuite({
    'name': 'unready-suite-should-skip',
    'setup': unreadySuiteSetupSpy
});

unreadySuiteTest('skips suite test when profile is unready', () => {
    expect.unreachable('Suite test should be skipped by readinessGate');
});
