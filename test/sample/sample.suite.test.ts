import { unlink } from 'node:fs/promises';
import { assert } from 'vitest';
import {
    createEnvironmentProfile,
    type IntegrationTestFixtures
} from '../../src/index.js';
import { addAllNumbersInFiles, createNumberFile, healthCheck } from './sampleProject/endpoints.js';

const suiteDirectory = './number-files-suite';

interface SharedNumberFile {
    'fileId': string;
}

const sampleApiSuite = createEnvironmentProfile<IntegrationTestFixtures>({
    'dependencyType': 'ExternalApi',
    'name': 'SampleApi shared suite',
    'riskLevel': 'High',
    'readinessChecks': [
        {
            'name': 'SampleApi health check',
            'verify': async (): Promise<boolean> => {
                const apiResult = await healthCheck();

                return apiResult.serviceStatus === 'healthy';
            }
        }
    ]
}).integrationSuite({
    'name': 'shared number files',
    'setup': async ({ resources }): Promise<() => Promise<void>> => {
        await resources.track<SharedNumberFile>(
            'shared number file with 10',
            async (): Promise<SharedNumberFile> => ({
                'fileId': await createNumberFile(10, suiteDirectory)
            }),
            async (resource): Promise<void> => {
                await unlink(`${ suiteDirectory }/${ resource.fileId }.txt`);
            }
        );

        await resources.track<SharedNumberFile>(
            'shared number file with 32',
            async (): Promise<SharedNumberFile> => ({
                'fileId': await createNumberFile(32, suiteDirectory)
            }),
            async (resource): Promise<void> => {
                await unlink(`${ suiteDirectory }/${ resource.fileId }.txt`);
            }
        );

        return async (): Promise<void> => {
            /*
             * The returned callback represents suite-owned cleanup paired with setup.
             * ResourceTracker handles the registered files above in LIFO order.
             */
        };
    }
});

sampleApiSuite('reads shared state created during suite setup', async ({ resources, environment }) => {
    resources.markNoResources();

    assert.ok(environment.ready);

    assert.equal(await addAllNumbersInFiles(suiteDirectory), 42);
});

sampleApiSuite('reuses shared state across tests', async ({ resources, environment }) => {
    resources.markNoResources();

    assert.ok(environment.ready);

    assert.equal(await addAllNumbersInFiles(suiteDirectory), 42);
});
