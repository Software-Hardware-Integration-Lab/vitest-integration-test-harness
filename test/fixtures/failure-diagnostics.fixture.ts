/*
 * This file is intentionally not a .test.ts file, as it is used to validate the test
 * harness itself.
 * It is a fixture that is used to validate that the test harness is able to capture
 * failure diagnostics when a test fails.
 */

import { integrationTest } from '../../src/harness/integrationTestLifecycle.js';

integrationTest('emits failure diagnostics', ({ resources, diagnostics }) => {
    resources.track('my cloud resource', () => { /* No-op cleanup */ });

    diagnostics.record('diagnostic', { 'detail': 'context' });

    throw new Error('expected failure');
});
