# API Reference

Everything the package exports, grouped by what it is for. Import all of it from the package root. Paths under `src` are not a supported entry point and change without notice.

## Integration

| Export | Kind | Purpose |
| --- | --- | --- |
| `integrationTest` | Function | Vitest test API with readiness gating, resource tracking, and failure diagnostics already attached. Use it where you would use `test`. |
| `integrationSuite` | Function | Creates a test API with paired file-scoped setup and cleanup, built on `integrationTest`. Call it at a file's top level. |
| `createSuiteRunner` | Function | The same file-scoped lifecycle, bound to a test API you supply rather than the default. Used internally by a profile's `integrationSuite`, and available when you have built your own base test. |
| `createEnvironmentProfile` | Function | Bundles environment variables, readiness checks, fixtures, metadata, and readiness scope into a reusable profile. Returns `integrationTest`, `integrationSuite`, and a frozen `profile` snapshot. |

`integrationSuite(options)` and `createSuiteRunner(baseTest, options)` both take `IntegrationSuiteOptions`. `setup` must return a cleanup function and must declare resources on the tracker it is given; the returned cleanup is registered after that declaration is checked, and before any test body runs.

| Export | Kind | Shape |
| --- | --- | --- |
| `IntegrationTestFixtures` | Type | The four automatic fixtures: `environment`, `readinessGate`, `resources`, `diagnostics`. Extend it when adding your own. |
| `IntegrationSuiteOptions` | Type | `{ name, setup }`. `setup` receives an `IntegrationSuiteContext` and returns the cleanup for what it created. |
| `IntegrationSuiteContext` | Type | `{ resources }`, the file-scoped tracker available during suite setup. |

## Profiles

| Export | Kind | Shape |
| --- | --- | --- |
| `EnvironmentProfile` | Type | A profile definition: `name`, `dependencyType`, `riskLevel`, `readinessChecks`, optional `requiredEnvironmentVariables`, `fixtures`, `tags`, and `scope`. |
| `EnvironmentProfileResult` | Type | What `createEnvironmentProfile` returns: `integrationTest`, `integrationSuite`, and a readonly `profile`. |
| `ProfileFixtures` | Type | Custom fixture definitions for a profile, typed from Vitest's fixture extension API. Resolves to `never` if a reserved fixture name is used. |
| `DependencyType` | Type | Open union classifying the dependency. Suggested: `Database`, `InternalApi`, `ExternalApi`, `MessageQueue`, `BlobStorage`, `Cache`, `FileSystem`, `AuthenticationProvider`, `IdentityProvider`, `EmailService`, `NotificationService`, `SearchService`, `ConfigurationProvider`, `ThirdPartyService`. Any other string is accepted. |
| `RiskLevel` | Type | Open union describing how setup and teardown can affect other tests. Suggested: `Blocking`, `Important`, `Optional`. Any other string is accepted. |

Reserved fixture names that a profile cannot override: `environment`, `readinessGate`, `resources`, `diagnostics`. Using one throws when the profile is created.

`scope` sets when the profile's readiness is evaluated: `file` (the default) once per test file, `test` once per test, `worker` once per Vitest worker process.

## Environment

| Export | Kind | Purpose |
| --- | --- | --- |
| `evaluateEnvironmentVariables` | Function | Validates required variables against `process.env`, or a dictionary you pass as the second argument. Aggregates every failure into one reason. |
| `evaluateReadiness` | Function | Runs readiness checks in order and stops at the first that returns `false` or throws. |
| `EnvironmentReadiness` | Type | `{ ready, reason }`. `reason` is `undefined` when ready. |
| `ReadinessCheck` | Type | `{ name, verify }`. `verify` returns or resolves to a boolean; throwing counts as a failure. |
| `TestableEnvironmentVariable` | Type | `{ key, check? }`. `check` receives the value and is not called for a missing or whitespace-only one. |
| `EnvironmentVariableCheckResult` | Type | `{ success, reason? }` returned by a variable's `check`. |

Both functions return `EnvironmentReadiness`. `evaluateEnvironmentVariables` is synchronous; `evaluateReadiness` is async.

## Resources

| Export | Kind | Purpose |
| --- | --- | --- |
| `ResourceTracker` | Class | Runs paired resource setup and cleanup, cleaning up in LIFO order. Constructed as `new ResourceTracker(name, abortSignal?)`. |
| `ResourceCleanupError` | Error | Thrown after every cleanup has been attempted, when one or more failed. `failures` holds each description and error; `cause` is the first underlying error. |
| `ResourceSetupError` | Error | Thrown when a resource setup fails, or when one is attempted on an aborted tracker. Same `failures` and `cause` shape. |
| `ResourceCleanupFailure` | Type | `{ description, error }` for a single failed setup or cleanup. |

`ResourceTracker` methods:

| Method | Purpose |
| --- | --- |
| `track(description, setup, cleanup)` | Runs `setup(signal)`, registers `cleanup` with its result once setup succeeds, and counts as the tracker's declaration. Async, resolving to whatever `setup` returned. |
| `markNoResources()` | Declares that this run creates and modifies nothing. Mutually exclusive with `track`. |
| `registerCleanup(description, cleanup)` | Registers a zero-argument cleanup with no setup. Does not satisfy the declaration. |
| `assertDeclared()` | Throws unless `track` or `markNoResources()` was called. The lifecycle calls this for you. |
| `cleanupAll()` | Runs every registered cleanup in LIFO order. Async. |
| `getTrackedDescriptions()` | Snapshot of the descriptions still awaiting cleanup, in registration order. |
| `detachAbortSignal()` | Removes the listener attached to an external `AbortSignal` passed to the constructor. Runs no cleanup and cancels nothing. |

`cleanupAll()` never aborts early. Resources whose cleanup failed remain tracked and are retried by a later call; successful ones are removed.

A failed setup aborts the tracker. The signal handed to `setup` fires, and every later `track` call throws `ResourceSetupError` without running its setup. Passing your own `AbortSignal` to the constructor has the same effect from the outside.

`ResourceCleanupFailure` is the entry type for both error classes. It was named for cleanup and now covers setup failures too.

## Diagnostics

| Export | Kind | Purpose |
| --- | --- | --- |
| `Diagnostics` | Type | The `diagnostics` fixture: `record(label, detail)`, `addRedactionRules(rules)`, `addReporter(reporter)`. |
| `DiagnosticEntry` | Type | `{ label, detail }`, one recorded piece of context. |
| `DiagnosticRedactionRule` | Type | A string matched case-insensitively against a whole property name, or a regular expression tested against it. |
| `DiagnosticReporter` | Type | `{ report(payload) }`. Receives the payload after a failure; a reporter that throws is caught and logged. |
| `FailureDiagnosticsPayload` | Type | `{ failureMessages, recordedContext }` emitted after a test fails. |

Set `VITEST_INTEGRATION_HARNESS_ERROR_DETAILS=none` to replace failure messages and recorded error details with `[SUPPRESSED]`.

## Retry

| Export | Kind | Purpose |
| --- | --- | --- |
| `retry` | Function | Repeats a signal-aware operation until it succeeds, times out, hits the attempt limit, is cancelled, or `shouldRetry` rejects the error. |
| `pollUntil` | Function | Repeats a signal-aware check until its value satisfies a predicate, using `retry` underneath. |
| `RetryOptions` | Type | Timeout, intervals, backoff, jitter, cancellation, attempt limit, retry eligibility, and operation context. |
| `PollResult<T>` | Type | `{ value: T, attempts, elapsedMs }`. `T` is inferred from the operation or check, so a `pollUntil` over `Order` yields a `PollResult<Order>`. |
| `RetryTimeoutError` | Error | The deadline passed. Carries `attempts`, `lastError`, `context`. |
| `MaxRetryAttemptsReachedError` | Error | The attempt limit was hit before the deadline. Carries `attempts`, `lastError`, `context`. |
| `PollPredicateMismatchError` | Error | A polled value did not satisfy its predicate. Carries `lastValue`. |

`maxRetryAttempts` counts retries after the first attempt, so the operation runs `maxRetryAttempts + 1` times. When the timeout and the attempt limit are both exceeded, the timeout wins. See [Retry and Polling](Retry-and-Polling) for the full options table and validated ranges.
