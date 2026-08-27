# Readiness and Environment Variables

A test that needs a credential and does not have one should say so once, clearly, and then skip. It should not run, fail on a null reference somewhere deep in a client library, and leave you to work backwards to the actual cause.

The harness has two mechanisms for this, and they run in a fixed order.

## Variables first, then checks

A profile validates its required environment variables before it runs any readiness check. If a variable is missing, the checks never execute at all.

That ordering is deliberate, and so is the difference in how the two report failures.

Missing configuration is a batch problem. If four variables are unset, you want to know about all four now, so you can set them in one pass. Discovering them one run at a time is four rounds of edit, run, wait, read. So `evaluateEnvironmentVariables` collects every failure and reports them together.

A readiness check is different. Once "credentials are valid" has failed, running "the tenant is reachable" tells you nothing you can act on, and it may hang or throw something misleading. So `evaluateReadiness` stops at the first failure and reports that one.

The order between the two follows from the same reasoning. Checks usually need the variables to be present in order to mean anything, so validating variables first turns a confusing check failure into a precise configuration message.

## `evaluateEnvironmentVariables`

```ts
import {
    evaluateEnvironmentVariables,
    type EnvironmentVariableCheckResult
} from '@software-hardware-integration-lab/vitest-integration-test-harness';

function isPositivePort(value: string): EnvironmentVariableCheckResult {
    const port = Number(value);

    return Number.isInteger(port) && port > 0 && port < 65_536
        ? { 'success': true }
        : { 'success': false, 'reason': 'Must be an integer from 1 through 65535' };
}

const readiness = evaluateEnvironmentVariables([
    { 'key': 'SERVICE_BASE_URL' },
    { 'key': 'SERVICE_PORT', 'check': isPositivePort }
]);
```

It reads `process.env` by default. Pass a dictionary as the second argument to check against something else, which is mainly useful when testing your own validation logic.

Each variable needs a `key`. The optional `check` receives the value and returns `{ success, reason }`. A check that throws is treated as a failure and its error message becomes the reason, so you do not have to wrap parsing code in a try block.

Failures are joined into a single reason of the form `KEY: reason, KEY: reason`. The reason for each is one of:

| Situation | Reason |
| --- | --- |
| Variable absent from the environment | `Variable is not set` |
| Present but empty or whitespace only | `Variable is empty` |
| `check` returned `success: false` with no reason | `Validation check failed` |
| `check` returned `success: false` with a reason | that reason, trimmed |
| `check` threw | the thrown error's message |

A reason that is empty or only whitespace after trimming falls back to `Validation check failed`. Worth knowing if you build the reason by interpolation, since a template that resolves to an empty string silently loses your message.

A `check` is not called for a variable that is missing or whitespace-only. Those fail before validation runs, so your check never has to defend against an empty string.

## `evaluateReadiness`

```ts
import {
    evaluateReadiness,
    integrationTest
} from '@software-hardware-integration-lab/vitest-integration-test-harness';

export const test = integrationTest.extend({
    'environment': [
        // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
        async ({}, use): Promise<void> => {
            await use(await evaluateReadiness([
                {
                    'name': 'service credentials are configured',
                    'verify': (): boolean => Boolean(process.env['SERVICE_TOKEN'])
                }
            ]));
        },
        { 'scope': 'file' }
    ]
});
```

Checks run in the order you list them and stop at the first one that returns `false` or throws. Order them so the cheapest and most fundamental come first: a check for a configured credential before a check that makes a network call with it.

The reason is built from the check's `name`, which is why names should read as claims rather than labels. A check named `service credentials are configured` produces `Readiness check 'service credentials are configured' reported the environment is not ready.` A check named `credentials` produces something considerably less helpful.

Two reason formats exist:

- A check returning `false` gives `Readiness check '<name>' reported the environment is not ready.`
- A check that throws gives `Readiness check '<name>' threw: <message>`

`verify` may be synchronous or asynchronous. Both are awaited.

## Both are opt-in

Neither mechanism is on unless you turn it on. Omit `requiredEnvironmentVariables` and no variable validation happens. Supply an empty `readinessChecks` array and the environment is ready.

This is what lets structural tests, the ones that check your code rather than a live service, run in any checkout with no configuration at all. They never declare a requirement, so nothing ever gates them.

## When the evaluation happens

The `extend` call above pins `environment` to `file` scope, which is also what a profile does unless you say otherwise. Both mechanisms then run once per test file and every test in that file reads the same answer.

A profile can move that with its `scope` field, to `test` for a fresh evaluation per test or `worker` for one shared across every file a Vitest worker runs. The trade is currency against cost, and [Environment Profiles](Environment-Profiles) has the reasoning.

The usual way to declare both together is a profile rather than the `extend` call above. See [Environment Profiles](Environment-Profiles). If tests are skipping and you want to know why, [Troubleshooting](Troubleshooting) covers reading the skip message.
