/*
 * This file is intentionally not a .test.ts file, as it is used to validate the test
 * harness itself.
 * It is a fixture that is used to validate that the test harness is able to capture
 * cleanup diagnostics when a cleanup fails.
 */

import { integrationTest } from '../../src/index.js';

integrationTest('emits cleanup failure diagnostics', ({ resources }) => {
    resources.track('my cloud resource', () => {
        throw new Error('cleanup exception');
    });
});
