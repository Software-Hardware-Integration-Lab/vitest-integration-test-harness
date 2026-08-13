# Vitest Integration Test Harness

Reusable Vitest fixtures for integration tests that call external services or mutate real resources. The harness
provides readiness gating, resource cleanup, and failure diagnostics without imposing a cloud provider or test-suite
structure.

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

## Readiness Checks

By default, every environment is considered ready. Extend the `environment` fixture when tests require credentials,
network access, or another precondition. A failed readiness check skips the test with an explanatory message.

```ts
import { evaluateReadiness, integrationTest } from '@software-hardware-integration-lab/vitest-integration-test-harness';

export const test = integrationTest.extend({
  'environment': [
    async ({ }, use): Promise<void> => {
      await use(await evaluateReadiness([
        {
          'name': 'service credentials are configured',
          'verify': () => Boolean(process.env['SERVICE_TOKEN'])
        }
      ]));
    },
    { 'scope': 'file' }
  ]
});
```

`evaluateReadiness` runs checks in order, stops at the first check that returns `false` or throws, and returns the
failure reason. A file-scoped environment fixture evaluates once per test file.

## Retry Utilities

Use `retry` for transient errors and `pollUntil` for eventually consistent reads. Both utilities support a timeout,
constant or exponential retry intervals with optional symmetric jitter, and cancellation through an `AbortSignal`.

```ts
import { pollUntil } from '@software-hardware-integration-lab/vitest-integration-test-harness';

const widget = await pollUntil(
  () => getWidget(widgetId),
  (result) => result.status === 'ready',
  {
    'timeoutMs': 30_000,
    'initialIntervalMs': 250,
    'maxIntervalMs': 2_000,
    'backoffMultiplier': 2,
    'jitterRatio': 0.25
  }
);
```

`retry` calls its operation until it returns successfully. `pollUntil` calls `check` until its result satisfies
`predicate`. Both return a `PollResult` containing the final value, the number of attempts, and elapsed time in
milliseconds. On timeout, both throw `RetryTimeoutError`, which includes the number of attempts and the most recent
error.

Set `jitterRatio` from `0` through `1` to randomize each delay symmetrically around its exponential-backoff value.
For example, `0.25` produces a delay within 25% above or below its nominal value. The default is `0`, so jitter is
opt-in.

`timeoutMs` is required. The remaining options default to `initialIntervalMs: 100`,
`maxIntervalMs: initialIntervalMs`, and `backoffMultiplier: 1`, giving a constant 100 ms retry interval by default.
Set `backoffMultiplier` above `1` and increase `maxIntervalMs` to use bounded exponential backoff. All interval values
must be finite non-negative numbers; `maxIntervalMs` cannot be less than `initialIntervalMs`; and
`backoffMultiplier` must be at least `1`. An aborted `signal` stops an in-progress retry or pending retry delay.

## Harness Behavior

- The `resources` fixture tracks cleanup callbacks for the current test. Cleanup runs after each test, whether it
  passes or fails, in reverse registration order (LIFO).
- A failed cleanup does not prevent remaining cleanup callbacks from running. After all callbacks are attempted,
  failures are reported together as `ResourceCleanupError`. Failed resources remain tracked for a later
  `ResourceTracker.cleanupAll()` retry; successfully cleaned resources are removed. The error's `failures` property
  retains every description/error pair, and its `cause` is the first underlying cleanup error.
- The `diagnostics` fixture is active automatically. Call `diagnostics.record(label, detail)` to capture serializable
  context; it is printed to `console.error` only when the test fails, together with Vitest's failure messages. Values
  of properties named `authorization`, `apiKey`, `connectionString`, `password`, `secret`, `token`, or `credential`
  (including nested properties) are redacted. Call `diagnostics.addRedactionRules(['serviceCredential', /cookie/iu])`
  to redact suite-specific property names as well.
- The `readinessGate` fixture is active automatically and skips tests whose `environment` result is not ready.

## Public API

The package exports `integrationTest`, `evaluateReadiness`, `retry`, `pollUntil`, `ResourceTracker`,
`ResourceCleanupError`, and `RetryTimeoutError`, plus the related TypeScript types: `EnvironmentReadiness`,
`ReadinessCheck`, `RetryOptions`, `PollResult`, `ResourceCleanupFailure`, `FailureDiagnosticsPayload`,
`Diagnostics`, `DiagnosticEntry`, `DiagnosticRedactionRule`, `DiagnosticReporter`, and `IntegrationTestFixtures`.

`ResourceTracker` is available for custom fixture composition. Most suites should use the automatic `resources` and
`diagnostics` fixtures provided by `integrationTest`.

## Source Layout

The package exposes its supported API only through `src/index.ts`. Consumers should import from the package root, not
from a file under `src`.

```text
src/
  index.ts                         Public package entry point
  harness/
    azure/                          Azure-specific lifecycle support
    base/
      public/                       Harness contracts and implementations exported by the package
        classes/                    Reusable public classes
        errors/                     Public error types
        interfaces/                 Public TypeScript contracts
        modules/                    Public functions and fixture composition
      private/                      Internal harness implementation details
        classes/                    Non-exported implementation classes
        interfaces/                 Non-exported implementation contracts
  utilities/
    public/                         Provider-agnostic public utilities
      errors/                       Utility error types
      interfaces/                   Utility option and result contracts
      modules/                      Utility functions such as retry and pollUntil
```

Files under a `public` folder form the package's implementation surface and may be re-exported by `src/index.ts`.
Files under a `private` folder are not part of the supported consumer API and can change without a compatibility
guarantee.

## Scripts

```sh
npm test
npm run lint
npm run build:Dev
npm run build:Prod
```

`build:Dev` emits JavaScript to `bin`. `build:Prod` emits JavaScript and declaration files to `bin`.
