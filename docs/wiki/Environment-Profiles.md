# Environment Profiles

Once a suite needs two or three environment variables and a couple of readiness checks, repeating that declaration in every test file stops being reasonable. A profile bundles everything one dependency needs: its variables, its checks, and any fixtures built on it. A test file can then name the dependency instead of restating its preconditions.

The package supplies the container. You supply what goes in it. A profile you write describes your dependency in terms the package never interprets.

## Creating a profile

```ts
import { createEnvironmentProfile } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { pingCache } from './support/cacheClient.js';

export const cache = createEnvironmentProfile({
    'name': 'session-cache',
    'dependencyType': 'Cache',
    'riskLevel': 'Optional',
    'tags': ['session', 'ephemeral'],
    'requiredEnvironmentVariables': [{ 'key': 'CACHE_URL' }],
    'readinessChecks': [
        {
            'name': 'cache responds to ping',
            'verify': async (): Promise<boolean> => pingCache()
        }
    ]
});
```

You get back three things.

`cache.test` is a test API with the profile's readiness already wired in, plus any custom fixtures. Use it where you would use `integrationTest`.

`cache.suite(options)` is the same thing with a file-scoped setup and cleanup pair attached. It takes the same options as [`integrationSuite`](Test-and-Suite-Lifecycle).

`cache.profile` is a frozen snapshot of the metadata. It exists so tooling can read what a suite depends on without executing anything.

## Checks run once per file

The readiness evaluation is file-scoped. Every test file that uses `cache.test` evaluates the variables and runs the checks once, and every test in that file shares the result.

That matters when a check costs something. The `pingCache()` above is a network call, so it fires once per test file using this profile, not once per test and not once per run. Ten test files means ten pings. If a check is expensive enough that this is a problem, cache the result in your own code; the harness will not do it for you across files.

Using it looks like an ordinary test file:

```ts
import { expect } from 'vitest';
import { cache } from './support/cacheProfile.js';

cache.test('stores and reads a session', async ({ resources }) => {
    expect(resources).toBeDefined();
});
```

## Metadata

Three fields describe the dependency. None of them changes behavior; the package never reads them to decide anything. They exist so that a person, or a script, can answer questions like "which suites touch identity?" without opening every file.

`dependencyType` classifies what kind of thing this is. The suggested values are `Database`, `InternalApi`, `ExternalApi`, `MessageQueue`, `BlobStorage`, `Cache`, `FileSystem`, `AuthenticationProvider`, `IdentityProvider`, `EmailService`, `NotificationService`, `SearchService`, `ConfigurationProvider`, and `ThirdPartyService`.

`riskLevel` describes how this dependency's setup and teardown can affect other tests. The suggested values are `Blocking`, `Important`, and `Optional`.

The obvious reading of that is wrong, so it is worth slowing down on. Risk is not how important the dependency is to your product. A payment service might be the most business-critical thing you own and still be `Optional` here, if its test setup is isolated and its teardown cannot disturb anything else. A shared directory tenant might be `Blocking` despite being unglamorous, because tearing it down badly breaks every other suite. The field is about blast radius between tests.

Both types are open. They accept the suggested values with editor completion, and they also accept any other string:

```ts
import { createEnvironmentProfile } from '@software-hardware-integration-lab/vitest-integration-test-harness';

export const rig = createEnvironmentProfile({
    'name': 'hardware-rig',
    'dependencyType': 'serial-hardware',
    'riskLevel': 'isolated-sandbox',
    'readinessChecks': []
});
```

`tags` is an optional array of your own strings. The package stores them and never looks at them.

## Custom fixtures

A profile can carry fixtures, which is usually where the client for the dependency lives so tests do not each construct one.

```ts
import { createEnvironmentProfile } from '@software-hardware-integration-lab/vitest-integration-test-harness';

export const cache = createEnvironmentProfile<{ 'cacheKeyPrefix': string }>({
    'name': 'session-cache',
    'dependencyType': 'Cache',
    'riskLevel': 'Optional',
    'readinessChecks': [],
    'fixtures': {
        'cacheKeyPrefix': [
            // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
            async ({}, use: (prefix: string) => Promise<void>): Promise<void> => {
                await use('test-run');
            },
            { 'scope': 'test' }
        ]
    }
});
```

Four fixture names are reserved and cannot be overridden: `environment`, `readinessGate`, `resources`, and `diagnostics`. Using one throws as soon as the profile is created, with the message `Profile fixtures cannot override the reserved '<name>' fixture.`

The failure happens at creation rather than at test time on purpose. Overriding `resources` with something that does not clean up would produce leaked resources rather than an error, and that is a bad thing to discover later.

## The metadata snapshot is frozen

`profile` is deep-frozen, and the arrays you passed in are copied rather than referenced. Mutating your original array afterward does not change the snapshot, and your own objects are left unfrozen. The package does not reach back and freeze data you still own.

One field is exempt. `fixtures` keeps its original mutable reference, because Vitest annotates fixture definitions while extending the test API and freezing them would break that. If you check and find `fixtures` mutable while everything else is frozen, that is why, not a gap in the freezing.

## Composing profiles with a factory

When several profiles share requirements, write a function that stamps the common parts on.

```ts
import {
    createEnvironmentProfile,
    type DependencyType,
    type EnvironmentProfileResult,
    type ReadinessCheck,
    type RiskLevel,
    type TestableEnvironmentVariable
} from '@software-hardware-integration-lab/vitest-integration-test-harness';

interface ServiceProfileDefinition {
    'name': string;
    'dependencyType': DependencyType;
    'riskLevel': RiskLevel;
    'variables': readonly TestableEnvironmentVariable[];
    'checks': readonly ReadinessCheck[];
}

export function createServiceProfile(definition: ServiceProfileDefinition): EnvironmentProfileResult {
    return createEnvironmentProfile({
        'name': definition.name,
        'dependencyType': definition.dependencyType,
        'riskLevel': definition.riskLevel,
        'tags': ['service'],
        'requiredEnvironmentVariables': [
            { 'key': 'SERVICE_ENVIRONMENT' },
            ...definition.variables
        ],
        'readinessChecks': definition.checks
    });
}
```

Every profile built through that factory requires `SERVICE_ENVIRONMENT` without restating it, and adding a shared requirement later is one edit rather than one per profile.

[Cloud Profiles](Example-Azure-Profiles) shows this pattern applied to a realistic set of dependencies.
