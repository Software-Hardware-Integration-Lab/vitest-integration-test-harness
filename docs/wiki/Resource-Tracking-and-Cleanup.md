# Resource Tracking and Cleanup

An integration test that creates something has to delete it again, including on the paths where the test fails. Doing that with `try`/`finally` works for one resource and becomes unreadable at three. The `resources` fixture is the alternative: hand it the create and the undo together, and it owns the rest.

## Create through the tracker

`track` takes a description, a setup function that creates the resource, and a cleanup function that receives whatever setup returned.

```ts no-check
await resources.track(
    'example widget',
    (): Promise<Widget> => createWidget('example'),
    async (widget): Promise<void> => { await deleteWidget(widget.id); }
);
```

Setup runs immediately, and cleanup is registered the instant it succeeds. There is no window in which the widget exists and its undo does not. That is why creation lives inside the call rather than on the line above it: a create followed by a separate register leaves exactly one line where a throw leaks, and no amount of discipline closes a gap the API left open.

The description is for a person reading a failure. It appears in both setup and cleanup failure messages, so `Widget ${ id }` earns its extra characters over `widget`.

Cleanup runs after the test whether it passed or failed. You never call it.

## Getting at what you created

`track` resolves to an internal key rather than to the resource. When the test body needs what setup produced, capture it in the closure:

```ts no-check
let widget!: Widget;

await resources.track(
    'example widget',
    async (): Promise<Widget> => {
        widget = await createWidget('example');

        return widget;
    },
    async (created): Promise<void> => { await deleteWidget(created.id); }
);

expect(await getWidget(widget.id)).toEqual(widget);
```

Setup still has to return the resource, because that return value is what gets handed to cleanup later.

## Every test has to declare

A test must say whether it touches resources. Either it calls `track`, or it calls `markNoResources()`:

```ts no-check
integrationTest('reads a widget', async ({ resources }) => {
    resources.markNoResources();

    expect(await getWidget('widget-1')).toBeDefined();
});
```

A test that does neither and otherwise passes is failed afterward with `Integration run '<name>' must call resources.track(...) or resources.markNoResources().`

The declaration exists because the alternative failure is silent. A test that creates something and forgets to track it passes, leaks, and tells nobody. Requiring the sentence turns forgetting into a failed test rather than a resource you find weeks later on a billing report.

The check runs after the test body and after cleanup, and only when nothing else went wrong. A test that fails on its own assertion reports that assertion, not the missing declaration.

The two calls are mutually exclusive. `track` after `markNoResources()` throws `Cannot track '<description>' after markNoResources() was called.`, and `markNoResources()` after a successful `track` throws `Cannot call markNoResources() after resources have been tracked.`

## When setup fails

A setup function that throws produces a `ResourceSetupError`. The resource is not registered for cleanup, since it was never created, and everything tracked before it stays in the stack and is still cleaned up.

The tracker also aborts. Every later `track` call on the same tracker throws `ResourceSetupError` without running its setup at all:

```ts no-check
await resources.track('first', () => createWidget('a'), deleteIt);   // succeeds
await resources.track('second', () => createWidget('b'), deleteIt);  // throws
await resources.track('third', () => createWidget('c'), deleteIt);   // throws without calling createWidget
```

In a normal test body the first failure propagates out of its `await` and ends the test, so the third line never runs anyway. The abort matters for setups running concurrently: whatever is already in flight gets a signal instead of being left to finish building something nobody will clean up.

That signal is the first argument to your setup function. Forward it:

```ts no-check
await resources.track(
    'example widget',
    (signal): Promise<Widget> => createWidget('example', { signal }),
    async (widget): Promise<void> => { await deleteWidget(widget.id); }
);
```

`ResourceSetupError` carries a `failures` array of `{ description, error }`, and its `cause` is the first underlying error. The message reads `[creates a widget] 1 resource setup action failed:` followed by a `description: reason` line.

## Write cleanups that tolerate absence

A cleanup action must succeed when the resource is already gone. Tests delete things themselves, other cleanups cascade, and a retry may run the same cleanup twice. Treat "not found" as success rather than an error, or the tracker reports a failure for work that is already done.

## Cleanup runs in reverse

Registered resources are cleaned up last-in-first-out. Create a container, then a file inside it, and the file is removed before the container, which is usually the only order that works.

Cleanup never stops early. If the third of five callbacks throws, the remaining two still run. One broken cleanup cannot strand everything registered before it, which is the whole reason failures are collected rather than thrown immediately.

## What happens when a cleanup fails

Every callback is attempted first. Only then is a `ResourceCleanupError` thrown, carrying all of them.

Its `failures` property holds one entry per failure, each with the `description` you supplied and the `error` that was raised. Its `cause` is the first underlying error, so the usual error-chain tooling still finds something useful. The message lists every failure, prefixed with the test name and a count, like `[creates a widget] 2 resource cleanup actions failed:`, followed by one `description: reason` line per failure.

Resources whose cleanup failed stay tracked. Successful ones are removed. That combination means calling `cleanupAll()` again retries only what is still outstanding, rather than attempting to delete things that are already gone:

```ts
import { ResourceTracker } from '@software-hardware-integration-lab/vitest-integration-test-harness';

async function cleanupWithOneRetry(tracker: ResourceTracker): Promise<void> {
    try {
        await tracker.cleanupAll();
    } catch {
        await tracker.cleanupAll();
    }
}
```

The failed resources also keep their relative order, so a retry cleans them up in the same sequence they would have had originally.

You rarely need that retry helper, since the `resources` fixture calls `cleanupAll` once for you, but the behavior matters when a service is briefly rejecting deletes and you would rather try twice than leak.

## Using the tracker directly

`ResourceTracker` is exported for building your own fixtures.

```ts no-check
const tracker = new ResourceTracker('my fixture', externalSignal);
```

The name appears in failure messages. The optional second argument is an `AbortSignal` of your own: aborting it stops further setups exactly as an internal setup failure would, which is how you cancel provisioning when something outside the tracker has already gone wrong. A signal that is already aborted when the tracker is constructed makes the first `track` call fail without running anything.

Two other methods are worth knowing. `getTrackedDescriptions()` returns a snapshot of what is still outstanding, which is useful to record into diagnostics. `registerCleanup(description, cleanup)` adds a cleanup that takes no argument and has no setup, for undoing something the tracker did not create; it deliberately does not count as a declaration, so a fixture using it still leaves the test to say what it did.

Most suites never need any of this. The automatic `resources` fixture is the same class, already wired to the test lifecycle.

## Where cleanup meets the suite lifecycle

A file using `integrationSuite` has a second tracker, scoped to the file rather than the test. Suite setup declares against that tracker, and its ordering has a consequence that is easy to get backwards: the cleanup returned from `setup` runs before anything tracked during setup. [Test and Suite Lifecycle](Test-and-Suite-Lifecycle) works through it.
