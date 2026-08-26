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
import { createWidget, deleteWidget, getWidget, type Widget } from './support/widgetClient.js';

integrationTest('creates and reads a widget', async ({ resources }) => {
    let widget!: Widget;

    await resources.track(
        'example widget',
        async (): Promise<Widget> => {
            widget = await createWidget('example');

            return widget;
        },
        async (created): Promise<void> => { await deleteWidget(created.id); }
    );

    expect(await getWidget(widget.id)).toEqual(widget);
});
```

That runs immediately. There is no setup file to write and no configuration to add, because every environment is considered ready until you say otherwise.

The `resources.track` call is the shape that matters. Creating the widget happens *inside* the tracker rather than before it, which is what guarantees the widget gets deleted even when the `expect` below it throws. Registering cleanup separately, after the create, leaves one line where a failure leaks. That one line is the most common way integration suites leak resources.

The third argument receives whatever the second one returned, which is why setup has to return the resource. The test body gets at it through the closure, since `track` itself resolves to an internal key.

## Say what your test does

Every test declares whether it touches resources. Calling `track` is one way. A test that only reads says so:

```ts
import { expect } from 'vitest';
import { integrationTest } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { getWidget } from './support/widgetClient.js';

integrationTest('reads an existing widget', async ({ resources }) => {
    resources.markNoResources();

    expect(await getWidget('widget-1')).toBeDefined();
});
```

Skip both and the test fails after it passes, with `must call resources.track(...) or resources.markNoResources()`. One line of ceremony buys the guarantee that a test which quietly creates something untracked cannot go unnoticed.

## What you get without asking

Four fixtures are active on every `integrationTest`, whether or not your test destructures them.

| Fixture | What it does |
| --- | --- |
| `environment` | Holds the readiness result for the file. Resolves once per test file by default, not once per test. |
| `readinessGate` | Skips the test when `environment` reports it is not ready, using the reason as the skip message. |
| `resources` | Creates resources through tracked setup and cleanup, then runs the cleanups afterward in reverse order. |
| `diagnostics` | Records context that prints only if this test fails. |

`readinessGate` and `diagnostics` want nothing from you at all: a test in an unready environment is skipped rather than failing confusingly, and a failing test prints its diagnostics header even if you recorded nothing. `resources` is the one fixture that asks for a sentence back, and only that one sentence.

## Where to go from here

The default of "every environment is ready" is fine until your tests need a credential or a reachable service. When that happens, read [Readiness and Environment Variables](Readiness-and-Environment-Variables), which covers how to declare what a suite needs and how failures get reported.

Once you have more than one dependency to describe, [Environment Profiles](Environment-Profiles) shows how to bundle the variables, checks, and fixtures for a dependency into something a test file can name in one line.

For what happens when a setup or a cleanup fails, and for the tracker's behavior beyond the single call above, see [Resource Tracking and Cleanup](Resource-Tracking-and-Cleanup).

For state shared by every test in a file rather than created per test, see [Test and Suite Lifecycle](Test-and-Suite-Lifecycle).
