# AI-Assisted Test Authoring

Ask a coding assistant to write an integration test against this package and you get code that looks right and is wrong in the same few ways every time: Vitest's plain `test` instead of `integrationTest`, cleanup in a `try`/`finally` block, exports that sound plausible and do not exist, and the suite cleanup ordering backwards.

Those are the generic Vitest patterns, which is what anything falls back on without the specifics in front of it. An instruction file is how you supply them. This page has one you can copy.

## Where the file goes

GitHub Copilot instruction-file discovery, frontmatter, and precedence vary by client and release. Consult the [GitHub Copilot custom instructions documentation](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot) and your client's documentation for the supported locations and fields.

For repositories with integration tests, a glob-scoped instruction file is usually the right starting point. It confines harness-specific rules to the test files they govern. Repository-wide instructions are the right home for what is true everywhere, like your lint rules.

This example uses `.github/instructions/integration-tests.instructions.md` with an `applyTo` glob. Adjust the location and supported frontmatter to match the Copilot client your team uses.

## The instruction file

Save this as `.github/instructions/integration-tests.instructions.md` in the repository that contains your tests, not in the harness repository. Adjust the `applyTo` glob to match how your integration tests are named.

```markdown
---
description: 'Conventions for integration tests built on the Vitest integration test harness'
applyTo: '**/*.integration.test.ts'
---

# Integration test conventions

These tests use `@software-hardware-integration-lab/vitest-integration-test-harness`.

## Imports

- Import every harness value and type from the package root. Never import from a path under `src`.
- Use `integrationTest` where you would otherwise use Vitest's `test`. Keep importing `expect` and `describe` from `vitest`.
- Do not invent exports. If a name is not in the package's API reference, it does not exist.

## Resource cleanup

- Create every resource through `await resources.track(description, setup, cleanup)`. Never create it with a bare call and register cleanup afterward, and never use a `try`/`finally` block.
- `setup` receives an `AbortSignal` and returns the resource. `cleanup` receives exactly what `setup` returned.
- `track` resolves to an internal key, not to the resource. When the test body needs the resource, assign it to a variable inside `setup` and return it.
- Forward the `signal` argument to any client call that accepts one.
- Every test must declare. Call `track`, or call `resources.markNoResources()` for a test that creates and modifies nothing. A test that does neither fails after its body passes.
- Never call both in the same run. `track` after `markNoResources()` throws, and so does the reverse.
- Write the description for a human reading a failure. `Widget ${ widget.id }` beats `widget`.
- Every cleanup action must succeed when the resource is already gone. Treat "not found" as success.
- Cleanup runs last-in-first-out, so resources are removed in the reverse of the order they were created.
- A failed setup throws `ResourceSetupError` and aborts the tracker, so every later `track` call throws without running. Do not write recovery logic around this.

## Suites

- Call `integrationSuite` only at the top level of a test file. Never inside `describe` or inside another function.
- Its `setup` must return a cleanup function AND must declare on `context.resources`, exactly as a test does.
- That returned cleanup runs BEFORE anything tracked with `context.resources` during setup, because it is registered last and cleanup is LIFO.
- Create things needed part-way through setup with `context.resources.track`. Use the return value only for restoring state once setup has fully succeeded.
- Tests inside a suite still declare for themselves. Reading suite state is not a declaration; those tests call `resources.markNoResources()`.

## Readiness

- Declare what a suite needs with `createEnvironmentProfile`, or with `requiredEnvironmentVariables` and `readinessChecks` when it is one file.
- A profile returns `integrationTest`, `integrationSuite`, and `profile`. Use `profile.integrationTest` where you would use the standalone `integrationTest`.
- Environment variables are validated before readiness checks run.
- Readiness is evaluated once per file unless the profile sets `scope` to `test` or `worker`. Leave `scope` alone unless asked for it.
- Name a readiness check as a claim, such as `cache responds to ping` rather than `cache`. The name becomes the skip message.
- Never hand-write a check that skips a test because a credential is missing. Declare the requirement and let the readiness gate skip it.

## Diagnostics

- `diagnostics.record(label, value)` prints only when the test fails, so record freely rather than sparingly.
- Values are held by reference and copied at failure. Record a snapshot, such as `{ ...order }`, when the object is mutated later in the test.
- Redaction matches whole property names. `token` is covered and `accessToken` is not. Add `diagnostics.addRedactionRules([/token$/iu])` for compound names.
- Do not record client objects or class instances. They print as `[Non-plain diagnostic value]`. Record the plain fields that matter instead.

## Retry and polling

- Use `retry` for an operation that intermittently throws. Use `pollUntil` for one that succeeds immediately but returns the wrong value for a while.
- `maxRetryAttempts` counts retries after the first attempt, so the operation is called `maxRetryAttempts + 1` times.
- Write poll predicates to accept every terminal state, not only the successful one. Polling for success alone turns a failed resource into a timeout.
- Forward the `signal` argument to anything that accepts one, so a timeout cancels the work instead of abandoning it.
- `timeoutMs` must cover a full run of the operation. A success that arrives after the deadline is discarded and reported as a timeout.
```

## If you trim it, keep these

Most of the rules above save you an edit. Four of them save you a debugging session.

Creating a resource outside `track` is the one that costs real money. The declaration rule catches the test that creates nothing and says nothing, but it cannot catch a test that creates a widget with a bare call and then tracks something else. That test declares, passes, and leaks.

A cleanup that treats "already gone" as an error turns a clean run into a `ResourceCleanupError` about work that was already done.

The suite ordering rule is the one nobody guesses correctly, because the cleanup you return reads like it should run last and runs first.

Recording an object that gets mutated later prints the final state under a label describing the earlier one, which is worse than printing nothing.

## Copilot CLI

Copilot CLI support for repository instruction files and instruction-management commands can change between releases. Consult the current [Copilot CLI documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli) to confirm which instruction files are discovered, which fields are supported, and how to inspect the instructions active in a session.

## What this does not do

An instruction file biases output. It does not constrain it. Treat generated integration tests as a draft, and check two things by hand every time.

Check that every resource is created inside a `track` call. This is the rule assistants drop first when a test gets long: a bare `await createWidget(...)` with the tracking bolted on nearby reads fine and leaks. It is also the one that costs you real resources.

Check that requirements are declared rather than asserted. A generated test that reads `if (!process.env['SERVICE_TOKEN']) { return; }` has quietly turned itself into a test that never runs and always passes.

The rules above describe this package's behavior at the version you copied them. When you upgrade, read them against [API Reference](API-Reference) rather than assuming they still hold.
