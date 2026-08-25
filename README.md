# Vitest Integration Test Harness

Reusable Vitest fixtures for integration tests that call external services or mutate real resources. The harness
provides readiness gating, resource cleanup, and failure diagnostics without imposing a cloud provider or test-suite
structure.

## Provider-Agnostic by Design

The package supplies mechanisms. Your application supplies everything specific to it: the profiles describing your
dependencies, the credentials and how they are obtained, the clients that talk to your services, and any policy about
which environments may be tested against. Nothing in this package names a vendor, and nothing in it ships a credential.

That boundary is what keeps the harness reusable across applications with completely different dependencies. See
[Ownership Boundary](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/Ownership-Boundary)
for where the line falls and how to decide which side a change belongs on.

## Installation

Install this package and Vitest in the project containing your integration tests:

```sh
npm install --save-dev @software-hardware-integration-lab/vitest-integration-test-harness vitest
```

## Usage

Use `integrationTest` in place of Vitest's `test`. The supplied fixtures are active for every test.

```ts
import { expect } from 'vitest';
import { integrationTest } from '@software-hardware-integration-lab/vitest-integration-test-harness';

integrationTest('creates and reads a widget', async ({ resources }) => {
    const widget = await createWidget('example');

    resources.track(`Widget ${ widget.id }`, async () => { await deleteWidget(widget.id); });

    expect(await getWidget(widget.id)).toEqual(widget);
});
```

Register cleanup immediately after creating or mutating a resource. Cleanup actions can be synchronous or
asynchronous and should tolerate a resource that has already been removed.

That test runs with no configuration, because every environment is considered ready until a suite says otherwise.

## Documentation

Full documentation lives in the
[wiki](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki).

- [Getting Started](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/Getting-Started)
- [How-To Recipes](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/How-To)
- [AI-Assisted Test Authoring](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/AI-Assisted-Test-Authoring)
- [Test and Suite Lifecycle](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/Test-and-Suite-Lifecycle)
- [Readiness and Environment Variables](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/Readiness-and-Environment-Variables)
- [Environment Profiles](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/Environment-Profiles)
- [Retry and Polling](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/Retry-and-Polling)
- [Worked example](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/Example-Order-Service)
- [API Reference](https://github.com/Software-Hardware-Integration-Lab/vitest-integration-test-harness/wiki/API-Reference)

## Public API

Import everything from the package root. Paths under `src` are not a supported entry point.

| Export | Kind | Purpose |
| --- | --- | --- |
| `integrationTest` | Function | Vitest test API with automatic resource cleanup, failure diagnostics, and readiness gating. |
| `integrationSuite` | Function | Creates a test API with paired file-scoped setup and cleanup. |
| `createSuiteRunner` | Function | Attaches the file-scoped setup and cleanup lifecycle to a test API you supply. |
| `createEnvironmentProfile` | Function | Bundles environment variables, readiness checks, fixtures, and metadata into a reusable profile. |
| `evaluateReadiness` | Function | Runs readiness checks in order and returns a result containing the first failure reason, if any. |
| `evaluateEnvironmentVariables` | Function | Validates required environment variables and aggregates every failure into one reason. |
| `retry` | Function | Repeats a signal-aware operation until it succeeds, times out, hits the attempt limit, is cancelled, or `shouldRetry` rejects an error. |
| `pollUntil` | Function | Uses `retry` to repeat a signal-aware check until its value satisfies a predicate. |
| `ResourceTracker` | Class | Tracks cleanup callbacks and runs them in LIFO order. |
| `ResourceCleanupError` | Error class | Aggregates cleanup failures after every tracked callback has been attempted. |
| `RetryTimeoutError` | Error class | Reports a retry or poll timeout with the attempt count and most recent error. |
| `MaxRetryAttemptsReachedError` | Error class | Reports that the retry attempt limit was reached before the timeout. |
| `PollPredicateMismatchError` | Error class | Holds the most recent value that did not satisfy a polling predicate. |
| `EnvironmentReadiness` | Type | A readiness result containing a boolean state and optional failure reason. |
| `ReadinessCheck` | Type | A named synchronous or asynchronous verification that returns `true`, `false`, or throws. |
| `TestableEnvironmentVariable` | Type | A required environment variable key with an optional value check. |
| `EnvironmentVariableCheckResult` | Type | The success flag and optional reason returned by a variable's check. |
| `EnvironmentProfile` | Type | A profile definition: metadata, readiness checks, variables, fixtures, and tags. |
| `EnvironmentProfileResult` | Type | The `test`, `suite`, and frozen `profile` returned by `createEnvironmentProfile`. |
| `ProfileFixtures` | Type | Custom fixture definitions for a profile, typed from Vitest's fixture extension API. |
| `DependencyType` | Type | Open union classifying a dependency, such as `Database` or `BlobStorage`. |
| `RiskLevel` | Type | Open union describing how a dependency's setup and teardown can affect other tests. |
| `RetryOptions` | Type | Configures retry timeout, intervals, backoff, jitter, cancellation, attempt limit, retry eligibility, and operation context. |
| `PollResult<T>` | Type | Contains a successful value of type `T`, attempt count, and elapsed time. |
| `ResourceCleanupFailure` | Type | A failed cleanup's resource description and error. |
| `FailureDiagnosticsPayload` | Type | Failure messages and recorded diagnostic entries emitted after a test fails. |
| `Diagnostics` | Type | Records diagnostic context, redaction rules, and failure reporters. |
| `DiagnosticEntry` | Type | A labeled diagnostic detail value. |
| `DiagnosticRedactionRule` | Type | A string or regular expression that identifies sensitive property names. |
| `DiagnosticReporter` | Type | Receives the diagnostic payload for a failed test. |
| `IntegrationTestFixtures` | Type | Fixtures supplied by `integrationTest`: environment, readiness gate, resources, and diagnostics. |
| `IntegrationSuiteContext` | Type | File-scoped resources available during integration suite setup. |
| `IntegrationSuiteOptions` | Type | Configures an integration suite's name and paired setup/cleanup. |

`ResourceTracker` and `createSuiteRunner` are available for custom fixture composition. Most suites should use the
automatic `resources` and `diagnostics` fixtures provided by `integrationTest`.

## Scripts

```sh
npm test
npm run lint
npm run build:Dev
npm run build:Prod
```

`build:Dev` emits JavaScript to `bin`. `build:Prod` emits JavaScript and declaration files to `bin`.
