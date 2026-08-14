import { integrationTest } from '../../src/harness/base/public/modules/integrationTestLifecycle.js';

integrationTest('emits diagnostics for both test and cleanup failures', ({ diagnostics, resources }) => {
    resources.track('fixture resource', () => {
        throw new Error('expected cleanup failure');
    });

    diagnostics.record('fixture diagnostic', { 'detail': 'context' });

    throw new Error('expected test failure');
});
