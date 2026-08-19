import { expect } from 'vitest';
import { integrationTest } from '../../src/index.js';

/** Number of times the file-scoped readiness fixture has initialized. */
let readinessInitializations = 0;

const test = integrationTest.extend({
    'environment': [
        // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
        async ({ }, use): Promise<void> => {
            readinessInitializations += 1;

            await use({
                'ready': true,
                'reason': void 0
            });
        },
        { 'scope': 'file' }
    ]
});

test('initializes readiness for the first test', () => {
    expect(readinessInitializations).toBe(1);
});

test('reuses file-scoped readiness for the second test', () => {
    expect(readinessInitializations).toBe(1);
});
