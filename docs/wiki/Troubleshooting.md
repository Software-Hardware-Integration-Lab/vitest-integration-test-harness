# Troubleshooting

## My tests are all skipping

That is the readiness gate, and it prints why. Vitest shows the skip reason next to the test name:

```
↓ creates an order [Integration environment is not ready: ORDER_API_TOKEN: Variable is not set]
```

The part after the colon is either an aggregated list of environment-variable problems or the name of the readiness check that failed. Fix what it names.

If the reason mentions a variable, note that all failing variables are listed at once, so set every one of them before running again rather than fixing them one at a time.

## A readiness check never runs

Environment variables are validated before readiness checks, and a variable failure stops the checks from running at all. If a check seems to be ignored, look at whether the profile's variables are satisfied first.

## Tests pass locally and skip in CI

The environment differs, and the skip reason will say how. Worth checking: variables set in a local shell profile but not in the CI environment, and readiness checks that make network calls the CI runner cannot make.

A skipped suite is not a passing suite. If you need CI to fail rather than skip when the environment is misconfigured, assert on that separately. The harness skips rather than fails, because a missing credential is usually an environment problem rather than a code defect.

## `ResourceCleanupError` after a test that passed

The test body succeeded and cleanup failed afterward. The message lists every cleanup that failed with its description and reason.

The usual cause is a cleanup that does not tolerate the resource already being gone. If the test deleted something itself, or an earlier cleanup cascaded, the delete runs against something that no longer exists. Treat "not found" as success inside cleanup callbacks.

Resources whose cleanup failed stay tracked, so if you are calling `cleanupAll()` yourself you can retry and only the outstanding ones are attempted again.

## `AggregateError` from a suite

Both the suite lifecycle and its cleanup failed. The message reads `Integration suite '<name>' failed and cleanup also failed.` and both errors are preserved: the first in `errors`, the cleanup error also as `cause`.

Read the first one first. A cleanup failure that follows a setup failure is often a consequence of it, since setup may not have created the thing cleanup is trying to remove.

## My suite's setup never runs

Two likely causes.

The environment is not ready. Setup is skipped entirely in that case, before it can do anything expensive. Check the skip reason on the file's tests.

Or `integrationSuite` was called inside a `describe` block. Vitest requires file-scoped fixtures at the top level of a test file, and this failure is quiet rather than loud. Setup simply does not happen. Move the call to the file's top level.

## Cleanup ran in the wrong order

Cleanup is LIFO, so the last thing registered is the first thing undone.

Inside a suite `setup`, this catches people out: the cleanup you return from `setup` is registered after anything you registered with `resources.track` during setup, so it runs first. [Test and Suite Lifecycle](Test-and-Suite-Lifecycle) has the ordering table.

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

That runs 5 files: 106 pass and 6 skip. The 6 skips are intentional. They are the fixtures that demonstrate the readiness gate skipping unready tests, so they skip themselves. A clean checkout with no environment variables set produces exactly that result.
