# Example: Order Service

A complete integration test against a fictional order service, using every mechanism the harness provides: an environment-variable schema, readiness checks, resource cleanup, diagnostics, and polling.

The service is about as plain as it gets. Orders get created, they sit in `pending` for a while, and eventually they become `fulfilled` or `cancelled`. Nothing about the domain should hold your attention. What should stand out is the shape of the test.

Everything on this page belongs to the application. None of it lives in the package.

## The profile

```ts
import {
    createEnvironmentProfile,
    type EnvironmentVariableCheckResult
} from '@software-hardware-integration-lab/vitest-integration-test-harness';

function isHttpsUrl(value: string): EnvironmentVariableCheckResult {
    try {
        return new URL(value).protocol === 'https:'
            ? { 'success': true }
            : { 'success': false, 'reason': 'Must use https' };
    } catch {
        return { 'success': false, 'reason': 'Must be an absolute URL' };
    }
}

export const orderApi = createEnvironmentProfile({
    'name': 'order-api',
    'dependencyType': 'ExternalApi',
    'riskLevel': 'Important',
    'tags': ['orders', 'read-write'],
    'requiredEnvironmentVariables': [
        { 'key': 'ORDER_API_BASE_URL', 'check': isHttpsUrl },
        { 'key': 'ORDER_API_TOKEN' }
    ],
    'readinessChecks': [
        {
            'name': 'order API responds to its health probe',
            'verify': async (): Promise<boolean> => {
                const response = await fetch(new URL('/health', process.env['ORDER_API_BASE_URL']));

                return response.ok;
            }
        }
    ]
});
```

`ORDER_API_BASE_URL` gets a check because a malformed URL produces a confusing failure much later, inside whatever client consumes it. Catching it here costs four lines and turns a stack trace into a sentence.

`ORDER_API_TOKEN` gets no check. The harness can confirm it is set and non-empty; whether it is *valid* is what the health probe is for.

The readiness check reads the base URL directly from `process.env`, which is safe here only because variable validation already ran. That ordering is guaranteed; see [Readiness and Environment Variables](Readiness-and-Environment-Variables).

`riskLevel` is `Important` rather than `Blocking` because this suite creates its own orders and cancels them; a botched teardown leaves a stray order but does not disturb other suites.

## The test

```ts
import { expect } from 'vitest';
import { pollUntil } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { cancelOrder, createOrder, getOrder } from './support/orderClient.js';
import { orderApi } from './support/orderApiProfile.js';

const test = orderApi.test;

test('an order reaches a terminal status', async ({ resources, diagnostics }) => {
    diagnostics.addRedactionRules(['customerEmail']);

    const order = await createOrder({
        'sku': 'demo-widget',
        'quantity': 1
    });

    resources.track(`Order ${ order.id }`, async () => { await cancelOrder(order.id); });

    diagnostics.record('created order', order);

    const settled = await pollUntil(
        (signal) => getOrder(order.id, signal),
        (current) => current.status === 'fulfilled' || current.status === 'cancelled',
        {
            'timeoutMs': 30_000,
            'initialIntervalMs': 250,
            'maxIntervalMs': 2_000,
            'backoffMultiplier': 2,
            'jitterRatio': 0.25,
            'operationContext': `order ${ order.id } settle`
        }
    );

    diagnostics.record('poll result', {
        'attempts': settled.attempts,
        'elapsedMs': settled.elapsedMs
    });

    expect(settled.value.status).toBe('fulfilled');
});
```

## What happens on a run

Take a developer who has cloned the repository and set nothing up.

The `environment` fixture resolves first. `ORDER_API_BASE_URL` and `ORDER_API_TOKEN` are both unset, so variable validation fails with `ORDER_API_BASE_URL: Variable is not set, ORDER_API_TOKEN: Variable is not set`. Both of them, in one message, so the next attempt sets both.

The health probe never runs. There would be nothing to probe, and a network error here would obscure the actual problem.

The readiness gate skips the test with that reason as its message. No order is created, so there is nothing to clean up, and no diagnostics are emitted because nothing failed.

Now the same test with the environment configured. Variable validation passes. The health probe runs once for the whole file. The test creates an order and registers its cancellation on the very next line, which means the order is cleaned up even if `pollUntil` times out. Polling starts at 250 ms and backs off toward 2 s with jitter, until the order reaches a terminal state or 30 seconds pass.

If the order settles as `fulfilled`, the test passes and nothing is printed. The cleanup still runs and cancels the order.

If it settles as `cancelled`, the predicate is satisfied and the final assertion fails. Diagnostics then print the created order, the poll result, and Vitest's failure message. That is enough to see that polling worked correctly and the order genuinely went the other way.

## What stays out of the output

`ORDER_API_TOKEN` never appears in diagnostics. It is not recorded, and if it were nested inside a recorded object under a property named `token` the built-in rules would redact it.

`customerEmail` is redacted because the test asked for it. The package has no way to know that field is sensitive. It is an ordinary property name on an ordinary object, and guessing would mean redacting half of every payload. Naming it is one line, and it applies retroactively to the order recorded before the rule existed.

Watch the exact-match behavior here. If the client returned `accessToken` rather than `token`, the built-in rules would **not** cover it, because they anchor to the whole property name. [Failure Diagnostics](Failure-Diagnostics) covers the pattern rules for that case.

## What this example is not

There is no real credential on this page, and no rule about which environment may be tested against. `ORDER_API_BASE_URL` is whatever you point it at.

Deciding that some environments are off limits is a real requirement, and it belongs in your application. A readiness check that refuses to proceed against the wrong target is the natural place. It does not belong in the package, for the reasons in [Ownership Boundary](Ownership-Boundary).
