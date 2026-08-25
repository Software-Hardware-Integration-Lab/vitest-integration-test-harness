# How-To Recipes

The other pages explain one mechanism at a time. These recipes start from a task and pull in whatever mechanisms it needs, linking back to the page that covers each in full.

## Adopt the harness in a suite that already exists

You have integration tests using Vitest's `test`. You want cleanup and readiness gating without rewriting the suite in one sitting.

Do it in three passes, and stop after whichever one is enough.

**Pass one is an import change.** Swap `test` for `integrationTest` and change nothing else.

```ts
import { expect } from 'vitest';
import { integrationTest } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { getWidget } from './support/widgetClient.js';

integrationTest('reads a widget', async () => {
    expect(await getWidget('widget-1')).toBeDefined();
});
```

Nothing about that test changes behavior. No readiness is declared, so the environment counts as ready, and the fixtures it never mentions cost it nothing beyond a tracker that ends up empty. What you gain immediately is the failure output: when that test breaks, you get a diagnostics header naming it rather than a bare stack.

**Pass two moves your `try`/`finally` cleanup onto `resources`.** This is where the real payoff is, and it can be done one test at a time.

```ts no-check
// Before
const widget = await createWidget('example');

try {
    expect(await getWidget(widget.id)).toEqual(widget);
} finally {
    await deleteWidget(widget.id);
}

// After
const widget = await createWidget('example');

resources.track(`Widget ${ widget.id }`, async () => { await deleteWidget(widget.id); });

expect(await getWidget(widget.id)).toEqual(widget);
```

Two tests in the same file can be on either side of this change at once, so there is no flag day.

**Pass three declares what the suite needs**, once the first two have settled. That is [Readiness and Environment Variables](Readiness-and-Environment-Variables) if it is one file, or [Environment Profiles](Environment-Profiles) if the same dependency shows up in several.

Pass three is the only one that can make a test stop running, so get the cleanup right while everything still executes, then add the gate.

## Gate a suite on a dependency that provisions asynchronously

Some dependencies are not ready the moment their credentials are valid. A container is still starting, a deployment slot is still warming, a test tenant was created by a previous CI stage and has not propagated yet.

A readiness check can wait, because `verify` may be asynchronous and is awaited:

```ts
import { createEnvironmentProfile, pollUntil } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { pingCache } from './support/cacheClient.js';

export const cache = createEnvironmentProfile({
    'name': 'session-cache',
    'dependencyType': 'Cache',
    'riskLevel': 'Optional',
    'requiredEnvironmentVariables': [{ 'key': 'CACHE_URL' }],
    'readinessChecks': [
        {
            'name': 'cache accepts connections',
            'verify': async (): Promise<boolean> => {
                await pollUntil(
                    () => pingCache(),
                    (reachable) => reachable,
                    { 'timeoutMs': 60_000, 'initialIntervalMs': 1_000, 'operationContext': 'cache warmup' }
                );

                return true;
            }
        }
    ]
});
```

Three things about that are deliberate.

The poll is inside the check rather than in each test. Readiness is file-scoped, so the wait happens once per test file instead of once per test.

`pollUntil` throws on timeout rather than returning `false`, and a readiness check that throws is a failure whose reason is the error message. So the skip message ends up reading `Readiness check 'cache accepts connections' threw: [cache warmup] Retry operation timed out after 60 attempts`, which tells you it never came up rather than just that it was down.

`timeoutMs` here is a ceiling on how long an unavailable dependency stalls your suite, so pick it against your CI patience rather than against the service's usual startup. See [Retry and Polling](Retry-and-Polling) for the option ranges and for why a late success still counts as a timeout.

## Share one profile across many files without paying for the check every time

Readiness runs once per test file. Ten files using the same profile means ten evaluations, and if the check makes a network call, ten calls.

That is usually fine. When it is not, memoize in your own module, because the harness deliberately does not do this for you:

```ts
import { createEnvironmentProfile } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { pingCache } from './support/cacheClient.js';

let reachable: Promise<boolean> | undefined;

function cacheIsReachable(): Promise<boolean> {
    reachable ??= pingCache();

    return reachable;
}

export const cache = createEnvironmentProfile({
    'name': 'session-cache',
    'dependencyType': 'Cache',
    'riskLevel': 'Optional',
    'readinessChecks': [
        { 'name': 'cache responds to ping', 'verify': cacheIsReachable }
    ]
});
```

Caching the promise rather than the result matters: two files evaluating at once share the single in-flight call instead of racing to start a second one.

**How far this reaches depends on how you run Vitest.** Module state is shared across the files in one worker process, not across workers, so with the default pool you get one call per worker rather than one per run. If you need exactly one probe for the whole run no matter the pool layout, do it in a Vitest global setup file and pass the answer through the environment instead.

## Redact a credential field the built-in rules miss

The built-in redaction anchors to whole property names. `token` is covered. `accessToken` is not, and objects from real clients are full of names like that.

Add rules for the shapes your code actually produces:

```ts
import { integrationTest } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { getWidget } from './support/widgetClient.js';

integrationTest('reads a widget with a bearer credential', async ({ diagnostics }) => {
    diagnostics.addRedactionRules([/token$/iu, /^x-api-/iu, 'clientAssertion']);

    diagnostics.record('widget', await getWidget('widget-1'));
});
```

Put the `addRedactionRules` call at the top of the test, or in a fixture shared by the suite. It works anywhere, since rules apply retroactively to anything already recorded, but a reader who sees it first has one less thing to verify.

A regular expression is tested against the property name, so `/token$/iu` covers `accessToken`, `refreshToken`, and `bearerToken` in one rule. Better than listing the three you have thought of.

For what redaction does and does not reach, including why recording a client object gets you a placeholder, see [Failure Diagnostics](Failure-Diagnostics).

## Test your own variable schema without running the suite

A `check` function is code, and code with a bug rejects a perfectly good configuration or waves a bad one through. You do not have to discover that by setting real environment variables and running the integration suite.

`evaluateEnvironmentVariables` takes the environment to read as a second argument, so you can hand it a literal. Combined with the profile's frozen metadata, the schema tests itself:

```ts
import { expect, test } from 'vitest';
import { evaluateEnvironmentVariables } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { cache } from './support/cacheProfile.js';

const variables = cache.profile.requiredEnvironmentVariables;

test('accepts a complete configuration', () => {
    expect(evaluateEnvironmentVariables(variables, { 'CACHE_URL': 'redis://localhost:6379' }).ready).toBe(true);
});

test('reports every missing variable at once', () => {
    const result = evaluateEnvironmentVariables(variables, {});

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('CACHE_URL: Variable is not set');
});
```

These are ordinary Vitest tests, not integration tests. They touch nothing live, they run in any checkout, and they read the real schema rather than a copy of it, so a variable added to the profile is covered here the moment it is added.

Failures are aggregated, so an empty environment reports all of them in one reason instead of the first. And a `check` never runs for a variable that is missing or whitespace only, which means a check written to assume it gets a non-empty string is correct rather than fragile.

## Related pages

[Order Service](Example-Order-Service) puts most of these together in one working file set. [Troubleshooting](Troubleshooting) starts from a symptom instead of a task, which is the better entry point when something is already broken.
