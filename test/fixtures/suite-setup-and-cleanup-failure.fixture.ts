import { integrationSuite } from '../../src/index.js';

const test = integrationSuite({
    'name': 'failing suite setup',
    'setup': ({ resources }): never => {
        resources.track('partially created suite resource', () => {
            throw new Error('suite cleanup failed');
        });

        throw new Error('suite setup failed');
    }
});

test('does not run after suite setup fails', (): void => {
    throw new Error('test body should not run');
});
