# Vitest Integration Test Harness

Reusable Vitest fixtures for tests that call real services and change real state.

Integration tests fail in ways unit tests don't. A missing credential produces forty confusing assertion failures instead of one clear message. A test that creates a record and then throws leaves that record behind, and the next run inherits the mess. A failure in CI prints a stack trace that says nothing about what the test was actually doing when it broke.

This package exists for those three problems. It gates tests on whether the environment is ready, tracks what you create so it gets cleaned up whether the test passes or fails, and captures context that prints only when something goes wrong. It also ships retry and polling helpers, since services that are eventually consistent need them and every suite otherwise writes its own.

## What it is not

It is not a cloud SDK. It contains no provider client, no credential handling, and no knowledge of any particular service. It does not tell you how to structure your suites, and it does not ship policy about which environments you are allowed to test against.

None of that is an oversight. The moment a harness knows about one provider, it stops being usable by the next application that needs it.

## Where the line falls

The package supplies mechanisms. Your application supplies everything specific: the profiles describing your dependencies, the credentials and how they are obtained, the clients that talk to your services, and the rules about what may be touched. A profile you write names your dependency and its preconditions; the package runs it without ever knowing what it describes.

[Ownership Boundary](Ownership-Boundary) states this in full, including the practical test for deciding where a change belongs.

## Requirements

Vitest is a peer dependency, and the supported range is `>=4.1.10 <5`. The package is built and tested against Node 24.18 and later.

Nothing else is required. There is no configuration file, no global setup hook, and no environment variable you must set before the fixtures work.

## Where to go next

If you want to see the smallest useful thing, read [Getting Started](Getting-Started). A working test is about ten lines and needs no configuration at all.

If you already know what you are trying to do, [How-To Recipes](How-To) is organized by task rather than by mechanism: adopting the harness in a suite that already exists, waiting on a dependency that provisions slowly, redacting a credential the defaults miss.

If you would rather see the whole picture first, [Order Service](Example-Order-Service) is a complete example that combines readiness checks, an environment-variable schema, cleanup, diagnostics, and polling in one file set. [Cloud Profiles](Example-Azure-Profiles) shows the same ideas applied to a realistic set of application-owned dependencies.

If your team writes tests with a coding assistant, [AI-Assisted Test Authoring](AI-Assisted-Test-Authoring) has an instruction file to drop into your repository. Without one you get generic Vitest patterns, wrong in the same few ways every time.

For a specific mechanism, the sidebar lists each one. For a specific export, [API Reference](API-Reference) covers all 33.
