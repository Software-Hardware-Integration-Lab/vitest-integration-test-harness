import { integrationSuite } from '../../src/index.js';

const test = integrationSuite({
    'name': 'unready suite lifecycle',
    'setup': (): () => void => {
        throw new Error('unready suite setup ran');
    }
}).extend({
    'environment': [
        // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
        async ({ }, use): Promise<void> => {
            await use({
                'ready': false,
                'reason': 'fixture environment is unavailable'
            });
        },
        { 'scope': 'file' }
    ]
});

test('skips the test body when the environment is unavailable', () => {
    throw new Error('unready environment allowed the test body to run');
});
