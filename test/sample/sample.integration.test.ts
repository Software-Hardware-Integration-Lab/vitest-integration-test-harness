import { unlink } from 'node:fs/promises';
import { assert, describe } from 'vitest';
import {
    createEnvironmentProfile,
    type IntegrationTestFixtures
} from '../../src/index.js';
import { healthCheck, addAllNumbersInFiles, createNumberFile } from '../sample/sampleProject/endpoints.js';

interface SampleResourceObject {
    'fileId': string;
}

// Must be created outside of suites/tests;
const sampleApiTest = createEnvironmentProfile<IntegrationTestFixtures>({
    'dependencyType': 'ExternalApi',
    'name': 'SampleApi',
    'riskLevel': 'High',
    'scope': 'test',
    'tags': ['example', 'sample', 'api'],
    'readinessChecks': [
        {
            'name': 'SampleApi health check',
            'verify': async (): Promise<boolean> => {
                // eslint-disable-next-line no-console
                console.log('[SampleApi] Checking environment readiness...');

                const apiResult = await healthCheck();

                // eslint-disable-next-line no-console
                console.log(`[SampleApi] Health check status: ${ apiResult.serviceStatus }`);

                return apiResult.serviceStatus === 'healthy';
            }
        }
    ]

}).integrationTest;

void describe('Example usage test for integrationTest', () => {
    sampleApiTest('1 + 2 example test', async ({ resources, environment }) => {
        assert.ok(environment.ready, `Environment is not ready: ${ environment.reason ?? 'unknown reason' }`);

        // eslint-disable-next-line no-console
        console.log('[1 + 2 example test] Environment is ready; running test.');

        await resources.track<SampleResourceObject>(
            'number file with 1',
            async (): Promise<SampleResourceObject> => {
                const apiResult = await createNumberFile(1);

                return {
                    'fileId': apiResult
                };
            },
            async (resource): Promise<void> => {
                await unlink(`./number-files/${ resource.fileId }.txt`);
            }
        );

        await resources.track<SampleResourceObject>(
            'number file with 2',
            async (): Promise<SampleResourceObject> => {
                const apiResult = await createNumberFile(2);

                return {
                    'fileId': apiResult
                };
            },
            async (resource): Promise<void> => {
                await unlink(`./number-files/${ resource.fileId }.txt`);
            }
        );

        const sum = await addAllNumbersInFiles();

        assert.equal(sum, 3, `Expected sum of numbers in files to be 3, but got ${ sum }`);
    });

    sampleApiTest('12 + 20 example test', async ({ resources, environment }) => {
        assert.ok(environment.ready, `Environment is not ready: ${ environment.reason ?? 'unknown reason' }`);

        // eslint-disable-next-line no-console
        console.log('[12 + 20 example test] Environment is ready; running test.');

        await resources.track<SampleResourceObject>(
            'number file with 20',
            async (): Promise<SampleResourceObject> => {
                const apiResult = await createNumberFile(20);

                return {
                    'fileId': apiResult
                };
            },
            async (resource): Promise<void> => {
                await unlink(`./number-files/${ resource.fileId }.txt`);
            }
        );

        await resources.track<SampleResourceObject>(
            'number file with 12',
            async (): Promise<SampleResourceObject> => {
                const apiResult = await createNumberFile(12);

                return {
                    'fileId': apiResult
                };
            },
            async (resource): Promise<void> => {
                await unlink(`./number-files/${ resource.fileId }.txt`);
            }
        );

        const sum = await addAllNumbersInFiles();

        assert.equal(sum, 12 + 20, `Expected sum of numbers in files to be 3, but got ${ sum }`);
    });
});
