# Example: Cloud Profiles

The [order service example](Example-Order-Service) shows one profile against an invented service. Real applications have several dependencies at once, they share requirements, and they differ in how dangerous their teardown is.

This page shows three profiles for a realistic set of cloud dependencies: a directory tenant, a subscription, and a blob container. They are written against Azure and Entra because a concrete platform makes the example legible.

**Every line on this page belongs to the application.** None of it ships with the package, and the package has no notion that Azure exists. This is what the consumer-owned side of the boundary looks like when it is filled in.

## A factory for the shared parts

All three dependencies live in the same directory tenant, so all three need `AZURE_TENANT_ID` and all three want it validated the same way. That goes in a factory rather than being repeated three times.

```ts
import {
    createEnvironmentProfile,
    type DependencyType,
    type EnvironmentProfileResult,
    type EnvironmentVariableCheckResult,
    type ReadinessCheck,
    type RiskLevel,
    type TestableEnvironmentVariable
} from '@software-hardware-integration-lab/vitest-integration-test-harness';

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isGuid(value: string): EnvironmentVariableCheckResult {
    return guidPattern.test(value)
        ? { 'success': true }
        : { 'success': false, 'reason': 'Must be a GUID' };
}

interface CloudProfileDefinition {
    'name': string;
    'dependencyType': DependencyType;
    'riskLevel': RiskLevel;
    'variables': readonly TestableEnvironmentVariable[];
    'checks': readonly ReadinessCheck[];
}

export function createCloudProfile(definition: CloudProfileDefinition): EnvironmentProfileResult {
    return createEnvironmentProfile({
        'name': definition.name,
        'dependencyType': definition.dependencyType,
        'riskLevel': definition.riskLevel,
        'tags': ['cloud', 'application-owned'],
        'requiredEnvironmentVariables': [
            {
                'key': 'AZURE_TENANT_ID',
                'check': isGuid
            },
            ...definition.variables
        ],
        'readinessChecks': definition.checks
    });
}
```

Validating the tenant ID as a GUID is worth the four lines. A truncated or quoted value produces an authentication error from the SDK that names neither the variable nor the problem.

## The three profiles

```ts
import { createCloudProfile, isGuid } from './support/cloudProfileFactory.js';
import {
    canReadDirectory,
    canWriteBlobContainer,
    isSubscriptionRegistered
} from './support/cloudProbes.js';

export const directoryTenant = createCloudProfile({
    'name': 'directory-tenant',
    'dependencyType': 'IdentityProvider',
    'riskLevel': 'Blocking',
    'variables': [],
    'checks': [
        {
            'name': 'directory is readable with the configured identity',
            'verify': canReadDirectory
        }
    ]
});

export const subscription = createCloudProfile({
    'name': 'cloud-subscription',
    'dependencyType': 'ExternalApi',
    'riskLevel': 'Blocking',
    'variables': [
        {
            'key': 'AZURE_SUBSCRIPTION_ID',
            'check': isGuid
        }
    ],
    'checks': [
        {
            'name': 'required resource providers are registered',
            'verify': isSubscriptionRegistered
        }
    ]
});

export const blobContainer = createCloudProfile({
    'name': 'blob-container',
    'dependencyType': 'BlobStorage',
    'riskLevel': 'Important',
    'variables': [{ 'key': 'BLOB_CONTAINER_URL' }],
    'checks': [
        {
            'name': 'container accepts a write from the configured identity',
            'verify': canWriteBlobContainer
        }
    ]
});
```

No credential appears anywhere. The probes obtain identity however your application already does: a managed identity, a developer's signed-in CLI session, a federated credential in CI. The harness does not care, and provides no hook for it.

## Why the risk levels differ

`riskLevel` describes how a dependency's setup and teardown can disturb other tests. Applying that to these three gives different answers than a "how important is this?" reading would.

The directory tenant is `Blocking`. Directory objects are shared, and a teardown that half-completes leaves a group or a role assignment behind that other suites will trip over. If tenant teardown is unreliable, running anything else is a gamble.

The subscription is `Blocking` for the same reason. Resource groups, providers, and policy assignments are subscription-wide, so a failed cleanup is visible to every other suite using that subscription.

The blob container is `Important` rather than `Blocking` because a test run writes blobs under its own prefix. A failed cleanup leaves garbage that costs storage and annoys people, but it does not change what another test observes.

None of these is `Optional`, which is the honest answer for a set of shared cloud resources. `Optional` fits a dependency whose test state is genuinely isolated: a container started per run, a temporary directory, an in-memory service.

## Using them

```ts
import { expect } from 'vitest';
import { blobContainer } from './support/cloudProfiles.js';
import { deleteBlob, readBlob, uploadTestBlob, type Blob } from './support/blobClient.js';

const test = blobContainer.integrationTest;

test('uploads and reads back a blob', async ({ resources }) => {
    let blob!: Blob;

    await resources.track(
        'test blob',
        async (signal): Promise<Blob> => {
            blob = await uploadTestBlob('hello', signal);

            return blob;
        },
        async (uploaded): Promise<void> => { await deleteBlob(uploaded.name); }
    );

    expect(await readBlob(blob.name)).toBe('hello');
});
```

A test file names its dependency and gets the variables, the checks, and the gating that go with it. When the blob container's requirements change, one file changes.

## Back to the boundary

This page has a GUID validator, three probe functions, three profile definitions, and a factory. All of it is specific to one platform and one application's arrangement with it.

Putting any of it in the package would make the package know about Azure. The next application, using something else entirely, would carry that weight for nothing. And the moment two applications disagreed about what a tenant profile should require, one of them would have to fork.

[Ownership Boundary](Ownership-Boundary) has the full argument, including the test for deciding which side a change goes on.
