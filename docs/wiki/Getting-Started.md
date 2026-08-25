# Getting Started

## Install

```sh
npm install --save-dev @software-hardware-integration-lab/vitest-integration-test-harness vitest
```

Vitest is a peer dependency, so install it alongside the harness if your project does not already have it.

## Your first test

Use `integrationTest` where you would normally use Vitest's `test`. Everything else about the file stays the same.

```ts
import { expect } from 'vitest';
import { integrationTest } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { createWidget, deleteWidget, getWidget } from './support/widgetClient.js';

integrationTest('creates and reads a widget', async ({ resources }) => {
    const widget = await createWidget('example');

    resources.track(`Widget ${ widget.id }`, async () => { await deleteWidget(widget.id); });

    expect(await getWidget(widget.id)).toEqual(widget);
});
```

That runs immediately. There is no setup file to write and no configuration to add, because every environment is considered ready until you say otherwise.

The one line worth studying is the `resources.track` call. It registers the cleanup for the widget the instant after the widget exists, which means the widget gets deleted even if the `expect` below it throws. Registering cleanup at the end of a test is the most common way to leak resources, because the end of a test is exactly the part that does not run when something fails.

## What you get without asking

Four fixtures are active on every `integrationTest`, whether or not your test destructures them.

| Fixture | What it does |
| --- | --- |
| `environment` | Holds the readiness result for the file. Resolves once per test file, not once per test. |
| `readinessGate` | Skips the test when `environment` reports it is not ready, using the reason as the skip message. |
| `resources` | Tracks cleanup callbacks for this test and runs them afterward in reverse order. |
| `diagnostics` | Records context that prints only if this test fails. |

Two of those do useful work with no involvement from you at all. `readinessGate` and `resources` run whether or not your test mentions them, so a test that never touches `resources` still gets a tracker constructed and cleaned up, and a test in an unready environment still gets skipped rather than failing in a confusing way.

## Where to go from here

The default of "every environment is ready" is fine until your tests need a credential or a reachable service. When that happens, read [Readiness and Environment Variables](Readiness-and-Environment-Variables), which covers how to declare what a suite needs and how failures get reported.

Once you have more than one dependency to describe, [Environment Profiles](Environment-Profiles) shows how to bundle the variables, checks, and fixtures for a dependency into something a test file can name in one line.

For state shared by every test in a file rather than created per test, see [Test and Suite Lifecycle](Test-and-Suite-Lifecycle).
