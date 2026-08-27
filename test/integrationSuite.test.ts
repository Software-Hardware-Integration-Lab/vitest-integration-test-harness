import { expect, vi } from 'vitest';
import {
    createSuiteRunner,
    integrationSuite,
    integrationTest,
    type EnvironmentReadiness
} from '../src/index.js';

const suiteLifecycleOrder: string[] = [];

const suiteTest = integrationSuite({
    'name': 'in-process suite lifecycle',
    'setup': async ({ resources }): Promise<() => void> => {
        suiteLifecycleOrder.push('setup');

        await resources.track('additional suite state', (): Promise<object> => Promise.resolve({}), () => {
            suiteLifecycleOrder.push('additional cleanup');
        });

        return (): void => {
            suiteLifecycleOrder.push('paired cleanup');
        };
    }
});

suiteTest('runs suite setup before the test body and tracks resources', ({ resources }) => {
    resources.markNoResources();

    expect(suiteLifecycleOrder).toEqual(['setup']);
});

const customBaseTest = integrationTest.extend<{
    'customService': {
        'ping': () => string;
    };
}>({
    // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
    'customService': async ({ }, use): Promise<void> => {
        await use({
            'ping': (): string => 'pong'
        });
    }
});

const customSuiteOrder: string[] = [];

const directSuiteTest = createSuiteRunner(customBaseTest, {
    'name': 'direct-suite-runner',
    'setup': ({ resources }): () => void => {
        customSuiteOrder.push('setup');

        resources.markNoResources();

        return (): void => {
            customSuiteOrder.push('cleanup');
        };
    }
});

directSuiteTest('runs suite with custom integration base test runner', ({ customService, resources }) => {
    resources.markNoResources();

    expect(customService.ping()).toBe('pong');

    expect(customSuiteOrder).toEqual(['setup']);
});

const unreadyCustomBase = customBaseTest.extend<{
    '$file': {
        'environment': EnvironmentReadiness;
    };
}>({
    'environment': [
        // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
        async ({ }, use): Promise<void> => {
            await use({
                'ready': false,
                'reason': 'custom base runner is not ready'
            });
        },
        { 'scope': 'file' }
    ]
});

const unreadyCustomSuiteSpy = vi.fn();

const unreadyDirectSuiteTest = createSuiteRunner(unreadyCustomBase, {
    'name': 'unready-direct-suite-runner',
    'setup': unreadyCustomSuiteSpy
});

unreadyDirectSuiteTest('skips suite test when custom base runner environment is unready', () => {
    expect.unreachable('Suite test should be skipped by readinessGate on unready custom base');
});
