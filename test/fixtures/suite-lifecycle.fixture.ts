/* eslint-disable no-console -- This fixture emits lifecycle ordering for its parent self-test to assert. */
import { integrationSuite } from '../../src/index.js';

const test = integrationSuite({
    'name': 'shared suite state',
    'setup': async ({ resources }) => {
        console.log('[suite lifecycle] setup');

        await resources.track('additional shared state', (): Promise<object> => Promise.resolve({}), () => {
            console.log('[suite lifecycle] additional cleanup');
        });

        return (): void => {
            console.log('[suite lifecycle] paired cleanup');
        };
    }
});

test('runs the shared-state test', (): void => {
    console.log('[suite lifecycle] test');

    throw new Error('intentional suite lifecycle fixture failure');
});
