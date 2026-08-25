# AI-Assisted Test Authoring

Ask a coding assistant to write an integration test against this package and you get code that looks right and is wrong in the same few ways every time: Vitest's plain `test` instead of `integrationTest`, cleanup in a `try`/`finally` block, exports that sound plausible and do not exist, and the suite cleanup ordering backwards.

Those are the generic Vitest patterns, which is what anything falls back on without the specifics in front of it. An instruction file is how you supply them. This page has one you can copy.

## Where the file goes

GitHub Copilot reads several files, and they differ in what they apply to.

| File | Applies to | Frontmatter |
| --- | --- | --- |
| `.github/instructions/*.instructions.md` | Files matching an `applyTo` glob | `applyTo`, `description`, `excludeAgent` |
| `.github/copilot-instructions.md` | The whole repository | none |
| `.github/agents/*.agent.md` | An agent you invoke by name | `name`, `description`, `tools` |

Use the glob-scoped one. Integration test conventions are wrong for the rest of a repository, and `applyTo` is what keeps rules about resource cleanup from reaching a React component. Repository-wide instructions are the right home for things that are true everywhere, like your lint rules.

One file covers every surface your team uses. The IDE, the CLI, and Copilot code review all read `.github/instructions`, so this is not something you maintain in three places. If you want it in some of them but not others, `excludeAgent` takes `code-review` or `cloud-agent`.

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

- Register cleanup with `resources.track(description, cleanup)` on the line after the resource exists. Never at the end of the test, and never in a `try`/`finally` block.
- Write the description for a human reading a failure. `Widget ${ widget.id }` beats `widget`.
- Every cleanup action must succeed when the resource is already gone. Treat "not found" as success.
- Cleanup runs last-in-first-out, so resources are removed in the reverse of the order they were created.

## Suites

- Call `integrationSuite` only at the top level of a test file. Never inside `describe` or inside another function.
- Its `setup` must return a cleanup function.
- That returned cleanup runs BEFORE anything tracked with `context.resources` during setup, because it is registered last and cleanup is LIFO.
- Track things created part-way through setup with `context.resources` as soon as they exist. Use the return value only for restoring state once setup has fully succeeded.

## Readiness

- Declare what a suite needs with `createEnvironmentProfile`, or with `requiredEnvironmentVariables` and `readinessChecks` when it is one file.
- Environment variables are validated before readiness checks run.
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

Most of the rules above save you an edit. Four of them save you a debugging session, because breaking them produces a test that passes rather than a test that fails.

Registering cleanup at the end of a test works until an assertion throws before it, and then it leaks quietly for weeks.

A cleanup that treats "already gone" as an error turns a clean run into a `ResourceCleanupError` about work that was already done.

The suite ordering rule is the one nobody guesses correctly, because the cleanup you return reads like it should run last and runs first.

Recording an object that gets mutated later prints the final state under a label describing the earlier one, which is worse than printing nothing.

## Copilot CLI

The CLI reads the same file. It picks up `.github/instructions/**/*.instructions.md` and honors `applyTo`, so the file you added for the IDE works in a terminal session with nothing else to do.

It also reads `.github/copilot-instructions.md` and `AGENTS.md` from the repository, and `~/.copilot/copilot-instructions.md` and `~/.copilot/instructions/**/*.instructions.md` from your own machine. There is no defined precedence between them. The CLI combines whatever applies and drops exact duplicates, so putting the same rules in two of these gains you nothing and contradicting yourself across two of them is a genuine problem.

`/instructions` lists the instruction files discovered for the session and lets you switch individual ones off. That answers both questions worth asking: whether your file is being picked up at all, and whether it is actually the thing changing the output.

## What this does not do

An instruction file biases output. It does not constrain it. Treat generated integration tests as a draft, and check two things by hand every time.

Check where cleanup is registered. This is the rule assistants drop first when a test gets long, and it is the one that costs you real resources.

Check that requirements are declared rather than asserted. A generated test that reads `if (!process.env['SERVICE_TOKEN']) { return; }` has quietly turned itself into a test that never runs and always passes.

One maintenance note: the rules above describe this package's behavior at the version you copied them. When you upgrade, read them against [API Reference](API-Reference) rather than assuming they still hold.
