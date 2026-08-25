# Test and Suite Lifecycle

Two lifecycles run in a harness test file. One belongs to each test and repeats. The other belongs to the file and runs once. Most confusion about cleanup ordering comes from mixing them up, so this page keeps them separate and then shows where they meet.

## The per-test lifecycle

For every test the harness runs, in this order:

1. `environment` resolves. It is file-scoped, so this happens once for the whole file and every test in that file reads the same result.
2. `readinessGate` checks it. If the environment is not ready, the test is skipped with the reason as its message, and nothing below this line runs.
3. `resources` and `diagnostics` are constructed fresh for this test.
4. Your test body runs.
5. `resources.cleanupAll()` runs, in the fixture's `finally`, so it happens whether the body passed or threw.
6. If the test failed, the recorded diagnostics are flushed to `console.error`.

Steps 2, 3, 5, and 6 happen without your test mentioning any of it. `readinessGate`, `resources`, and `diagnostics` are automatic fixtures, which is why a test that destructures nothing still gets gated, tracked, and cleaned up.

Step 1 being file-scoped matters more than it looks. A readiness check that makes a network call runs once per file rather than once per test, so putting an expensive probe in a readiness check does not multiply across a file's tests.

## The suite lifecycle

When several tests in one file share state that should be prepared once and torn down once, use `integrationSuite`. It returns a test API, so you call it at the top of the file and use what it gives you.

```ts
import { expect } from 'vitest';
import { integrationSuite } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { createWidget, deleteWidget, restoreWidgetDefaults, getWidget } from './support/widgetClient.js';

const test = integrationSuite({
    'name': 'widget suite state',
    'setup': async ({ resources }) => {
        const widget = await createWidget('shared-widget');

        resources.track(`Widget ${ widget.id }`, async () => { await deleteWidget(widget.id); });

        return async (): Promise<void> => {
            await restoreWidgetDefaults(widget.id);
        };
    }
});

test('reads the shared widget', async () => {
    expect(await getWidget('shared-widget')).toBeDefined();
});
```

`setup` must return a cleanup function. That is not a convention you can opt out of. The return value is registered immediately, before any test body runs, so the state you just created is already scheduled for teardown by the time anything can fail.

For a file using `integrationSuite`, the sequence is:

1. `environment` evaluates for the file.
2. If it is not ready, `setup` never runs at all, and the readiness gate skips the file's tests.
3. If it is ready, `setup` runs once.
4. Its returned cleanup is registered with the suite's tracker immediately.
5. Each test runs with the normal per-test fixtures, including its own separate `resources`.
6. After every test in the file finishes, the suite tracker cleans up.

Step 2 is worth noticing. An unready environment does not run your setup and then skip the tests; it skips setup entirely, so a suite that provisions something expensive costs nothing when its credentials are missing.

## Cleanup runs backwards, and that surprises people

Cleanup is last-in-first-out. Resources are undone in the reverse of the order they were created, which is almost always what you want, since later resources tend to depend on earlier ones.

The consequence inside `setup` is easy to get backwards. Look at the registration order in the example above against the resulting cleanup order:

| Registered | What it is | Cleanup order |
| --- | --- | --- |
| First | `resources.track('Widget …', deleteWidget)` inside `setup` | Second |
| Last | the function `setup` returned | First |

The cleanup you return from `setup` runs **before** anything you registered with `resources.track` during setup, because it was registered last and cleanup is LIFO.

If you need the reverse, with the returned cleanup running after your tracked ones, register the tracked ones after `setup` returns, or move the work out of the return value and into a `resources.track` call so you control its position in the stack.

## When cleanup itself fails

A failing cleanup never stops the remaining cleanups from being attempted. Every tracked callback is tried, and only then are the failures reported together. Three outcomes are possible:

Only cleanup failed. A `ResourceCleanupError` is thrown, carrying every failed description and error in its `failures` property.

Setup or a test failed, and cleanup also failed. Both are preserved in an `AggregateError` whose message reads `Integration suite '<name>' failed and cleanup also failed.` and whose `cause` is the cleanup error. Neither failure hides the other, which matters because the cleanup failure is often a consequence of the first one.

Setup or a test failed and cleanup succeeded. The original error is thrown as-is.

[Resource Tracking and Cleanup](Resource-Tracking-and-Cleanup) covers what happens to resources whose cleanup failed, including the fact that they stay tracked and can be retried.

## Declare suites at the top level

`integrationSuite` must be called at the top level of a test file. Not inside `describe`, not inside another function.

Vitest requires file-scoped fixtures to be declared at the file's top level, and the suite lifecycle is built on one. Calling it inside a `describe` block does not throw a helpful error. It simply does not behave the way you expect. If a suite's setup seems not to run, this is the first thing to check.
