import { integrationSuite } from '../../src/index.js';

const test = integrationSuite({
    'name': 'suite setup only failure',
    'setup': (): never => {
        throw new Error('suite setup only failure');
    }
});

test('does not run after suite setup fails', (): void => {
    throw new Error('test body should not run');
});
