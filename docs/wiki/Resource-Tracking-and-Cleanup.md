# Resource Tracking and Cleanup

An integration test that creates something has to delete it again, including on the paths where the test fails. Doing that with `try`/`finally` works for one resource and becomes unreadable at three. The `resources` fixture is the alternative: register the undo as soon as the thing exists, and forget about it.

## Register immediately

```ts no-check
const widget = await createWidget('example');

resources.track(`Widget ${ widget.id }`, async () => { await deleteWidget(widget.id); });
```

The `track` call belongs on the line after the resource exists, not at the end of the test. The end of a test is the part that does not run when an assertion fails partway through.

The description is for humans. It shows up in cleanup failure messages, so `Widget ${ widget.id }` is worth typing over `widget`.

Cleanup runs after the test whether it passed or failed. You do not need to call anything.

## Write cleanups that tolerate absence

A cleanup action must succeed when the resource is already gone. Tests delete things themselves, other cleanups cascade, and a retry may run the same cleanup twice. Treat "not found" as success rather than an error, or the tracker will report a failure for work that is already done.

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

`ResourceTracker` is exported for building your own fixtures. Construct it with a name used in failure messages, and call `getTrackedDescriptions()` for a snapshot of what is still outstanding, which is useful to record into diagnostics.

Most suites never need this. The automatic `resources` fixture is the same class, already wired to the test lifecycle.

## Where cleanup meets the suite lifecycle

A file using `integrationSuite` has a second tracker, scoped to the file rather than the test. Its ordering has a consequence that is easy to get backwards: the cleanup returned from `setup` runs before anything registered during setup. [Test and Suite Lifecycle](Test-and-Suite-Lifecycle) works through it.
