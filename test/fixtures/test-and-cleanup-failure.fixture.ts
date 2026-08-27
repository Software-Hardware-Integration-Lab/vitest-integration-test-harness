import { integrationTest } from '../../src/index.js';

integrationTest('emits diagnostics for both test and cleanup failures', async ({ diagnostics, resources }) => {
    await resources.track('fixture resource', (): Promise<object> => Promise.resolve({}), () => {
        throw new Error('expected cleanup failure');
    });

    diagnostics.record('fixture diagnostic', { 'detail': 'context' });

    throw new Error('expected test failure');
});
