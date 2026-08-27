# Troubleshooting

## My tests are all skipping

That is the readiness gate, and it prints why. Vitest shows the skip reason next to the test name:

```
↓ creates an order [Integration environment is not ready: ORDER_API_TOKEN: Variable is not set]
```

The part after the colon is either an aggregated list of environment-variable problems or the name of the readiness check that failed. Fix what it names.

If the reason mentions a variable, all failing variables are listed at once, so set every one of them before running again rather than fixing them one at a time.

## A readiness check never runs

Environment variables are validated before readiness checks, and a variable failure stops the checks from running at all. If a check seems to be ignored, look at whether the profile's variables are satisfied first.

## Tests pass locally and skip in CI

The environment differs, and the skip reason will say how. Worth checking: variables set in a local shell profile but not in the CI environment, and readiness checks that make network calls the CI runner cannot make.

A skipped suite is not a passing suite. If you need CI to fail rather than skip when the environment is misconfigured, assert on that separately. The harness skips rather than fails, because a missing credential is usually an environment problem rather than a code defect.

## `must call resources.track(...) or resources.markNoResources()`

The test body ran to the end without saying whether it touches resources. Add whichever is true: `track` for a test that creates something, `resources.markNoResources()` for one that only reads.

The message names the run rather than the file, so in a suite it distinguishes a test that forgot from a `setup` that forgot.

The check runs after the body and after cleanup, which is why it can surface on a test whose assertions all passed. It never masks a real failure: a test that threw reports what it threw.

## `ResourceSetupError`

A setup function passed to `track` threw, or a `track` call ran on a tracker that had already aborted.

Read `failures[0]` for the description and the underlying error. Resources tracked before this one are unaffected and still get cleaned up; the one that failed was never registered, since it was never created.

## A `track` call failed without running its setup

Something earlier aborted the tracker. That is either a setup failure on the same tracker, or an `AbortSignal` you passed to the constructor firing.

The abort is permanent for that tracker's lifetime, by design. Once one resource could not be created, building more of them means creating things whose cleanup may already be in doubt.

If your setup itself needs to notice the abort, take the `signal` argument and forward it to whatever does the work.

## A suite's returned cleanup never ran

Look for a declaration failure in `setup`. The declaration is checked before the cleanup you returned is registered, so a `setup` that neither tracked anything nor called `markNoResources()` fails the file with that cleanup unregistered.

Anything setup created outside the tracker is then still there. Tracking what you create instead of creating it beside the tracker avoids the whole shape.

## `ResourceCleanupError` after a test that passed

The test body succeeded and cleanup failed afterward. The message lists every cleanup that failed with its description and reason.

The usual cause is a cleanup that does not tolerate the resource already being gone. If the test deleted something itself, or an earlier cleanup cascaded, the delete runs against something that no longer exists. Treat "not found" as success inside cleanup callbacks.

Resources whose cleanup failed stay tracked, so if you are calling `cleanupAll()` yourself you can retry and only the outstanding ones are attempted again.

## `AggregateError` from a test or a suite

Something failed and its cleanup failed too. The message says which lifecycle it was: `Integration test '<name>' failed and cleanup also failed.` for a test body, `Integration suite '<name>' failed and cleanup also failed.` for suite setup. Both errors are preserved either way: the first in `errors`, the cleanup error also as `cause`.

Read the first one first. A cleanup failure that follows a setup failure is often a consequence of it, since setup may not have created the thing cleanup is trying to remove.

## My suite's setup never runs

Two likely causes.

The environment is not ready. Setup is skipped entirely in that case, before it can do anything expensive. Check the skip reason on the file's tests.

If instead the file fails at collection with a `FixtureDependencyError` about the `suiteLifecycle` fixture, `integrationSuite` was called inside a `describe` block. Vitest requires file-scoped fixtures at the top level of a test file. Move the call there.

## Cleanup ran in the wrong order

Cleanup is LIFO, so the last thing registered is the first thing undone.

Inside a suite `setup`, this catches people out: the cleanup you return from `setup` is registered after anything you tracked during setup, so it runs first. [Test and Suite Lifecycle](Test-and-Suite-Lifecycle) has the ordering table.

## `Profile fixtures cannot override the reserved '<name>' fixture.`

The profile tried to define a fixture named `environment`, `readinessGate`, `resources`, or `diagnostics`. Those belong to the harness. Rename yours.

The error fires when the profile is created rather than when a test runs, which is why it appears at import time.

## Diagnostics printed `[Non-plain diagnostic value]`

Something with a prototype was recorded: a class instance, a client object, a response from an HTTP library. Only plain objects and arrays are copied recursively; `Error` is the one exception and becomes name, message, and stack.

Record the fields you need instead of the object itself.

`[Accessor diagnostic value]` means the same thing for a getter, whose value is not read.

## A secret appeared in diagnostic output

The built-in rules match whole property names, so `token` is redacted and `accessToken` is not. Add a rule for the names your payloads actually use:

```ts no-check
diagnostics.addRedactionRules([/token$/iu, 'sessionKey']);
```

Rules apply retroactively to everything recorded during the test, so adding one late still covers earlier entries.

## Running the structural tests

The package's own tests need no credentials and no configuration:

```sh
npm test
```

The suite should complete without unexpected failures. Its skips are intentional: the fixtures that demonstrate the readiness gate skipping unready tests skip themselves. A clean checkout with no environment variables set produces that expected result.
