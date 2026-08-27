import { integrationSuite } from '../../src/index.js';

const test = integrationSuite({
    'name': 'suite missing declaration',
    // Intentionally does not call resources.track(...) or resources.markNoResources().
    'setup': (): () => void => (): void => { /* No-op cleanup */ }
});

test('does not run after suite setup fails to declare resources', (): void => {
    throw new Error('test body should not run');
});
