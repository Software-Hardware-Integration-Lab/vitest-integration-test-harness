# Retry and Polling

Two helpers, for two different problems.

`retry` is for an operation that should succeed and sometimes doesn't: a request that occasionally returns a 503, a connection that intermittently resets. You call it until it stops throwing.

`pollUntil` is for an operation that succeeds immediately but returns the wrong answer for a while. Eventually consistent reads, resources that provision asynchronously, anything with a status field that changes on its own. You call it until its result satisfies a predicate.

Both return a `PollResult<T>` with the final `value` typed as `T`, the number of `attempts`, and `elapsedMs`. `T` is inferred from your operation or check, so polling a function that returns an `Order` gives you a `PollResult<Order>` and `settled.value` stays fully typed.

## Polling

```ts
import { pollUntil } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { getOrder } from './support/orderClient.js';

const orderId = 'order-123';

const settled = await pollUntil(
    (signal) => getOrder(orderId, signal),
    (order) => order.status === 'fulfilled' || order.status === 'cancelled',
    {
        'timeoutMs': 30_000,
        'initialIntervalMs': 250,
        'maxIntervalMs': 2_000,
        'backoffMultiplier': 2,
        'jitterRatio': 0.25,
        'operationContext': 'order settle'
    }
);
```

Write the predicate so it accepts every terminal state, not just the one you want. Polling for `status === 'fulfilled'` on an order that was cancelled burns the full timeout and then reports a timeout, which describes the symptom rather than what happened. Poll for "reached a terminal state", then assert which one it was.

## Options

| Option | Default | Accepted values |
| --- | --- | --- |
| `timeoutMs` | required | Integer, 1 through 2,147,483,647 |
| `initialIntervalMs` | `100` | Integer, 0 through 2,147,483,647 |
| `maxIntervalMs` | `initialIntervalMs` | Integer, `initialIntervalMs` through 2,147,483,647 |
| `backoffMultiplier` | `1` | Finite, at least 1 |
| `jitterRatio` | `0` | Finite, 0 through 1 |
| `maxRetryAttempts` | `Infinity` | Positive integer, or `Infinity` |
| `signal` | none | An `AbortSignal` |
| `shouldRetry` | retries everything | `(error, attempt) => boolean` |
| `operationContext` | none | String used to prefix error messages |

The defaults give you a constant 100 ms interval with no backoff and no jitter. Set `backoffMultiplier` above 1 and raise `maxIntervalMs` for bounded exponential backoff.

Jitter is symmetric around the nominal delay. A `jitterRatio` of `0.25` produces a delay within 25 percent above or below what the backoff calculated, which spreads out retries when several tests hit the same service at once.

Out-of-range values throw a `RangeError` immediately rather than being clamped, so a typo surfaces at the call rather than as strange timing later.

## Counting attempts

`maxRetryAttempts` counts retries **after** the first attempt. The operation is called `maxRetryAttempts + 1` times.

| `maxRetryAttempts` | Operation calls | Result on repeated failure |
| --- | --- | --- |
| `1` | 2 | `Max number of retry attempts reached (1) after 2 total attempts.` |
| `2` | 3 | `Max number of retry attempts reached (2) after 3 total attempts.` |
| `Infinity` (default) | until the timeout | `RetryTimeoutError` |

The error's `attempts` property is the total call count, not the retry count. In the second row that is `3`, not `2`. The message reports both numbers so the two are never confused.

If the timeout and the attempt limit are both exceeded, the timeout wins and you get a `RetryTimeoutError`.

The attempt-limit error arrives one backoff interval late. The delay before the next attempt is slept first, and only then is the limit noticed, so with `maxIntervalMs: 2_000` the failure surfaces up to two seconds after the final call returned. The attempt count is unaffected; only the reporting is delayed.

## A late success still fails

The deadline is checked again after your operation returns. If it has passed, the value is discarded and you get a `RetryTimeoutError` even though the call succeeded.

This catches people out with a generous `timeoutMs` and a slow final attempt. An operation that starts at 29.5 s into a 30 s budget and returns successfully at 31 s produces a timeout, not a result. Size `timeoutMs` against the whole window you are willing to wait, including one full run of the operation, rather than against the polling alone.

## Failing fast on permanent errors

By default every error is retried, including the ones that will never succeed. `shouldRetry` opts out:

```ts
import { retry } from '@software-hardware-integration-lab/vitest-integration-test-harness';
import { createOrder } from './support/orderClient.js';

const created = await retry(
    () => createOrder({ 'sku': 'demo-widget', 'quantity': 1 }),
    {
        'timeoutMs': 10_000,
        'shouldRetry': (error): boolean => !String(error).includes('400')
    }
);
```

Returning `false` rethrows the original error immediately, unwrapped. It does not become a `RetryTimeoutError`.

## Cancellation

Pass a `signal` to stop an in-progress operation or a pending delay. The operation and `check` callbacks receive a signal of their own, which combines your signal with the internal deadline. Forward it to anything that accepts one and the underlying work is cancelled rather than abandoned:

```ts
import { pollUntil } from '@software-hardware-integration-lab/vitest-integration-test-harness';

const statusUrl = 'https://example.invalid/things/1';

await pollUntil(
    async (signal): Promise<{ 'state': string }> => {
        const response = await fetch(statusUrl, { signal });

        return await response.json() as { 'state': string };
    },
    (body) => body.state === 'ready',
    { 'timeoutMs': 15_000 }
);
```

Without forwarding, a timeout leaves the last request running until it finishes on its own.

## Errors

`RetryTimeoutError` is thrown when the deadline passes. `MaxRetryAttemptsReachedError` is thrown when the attempt limit is hit first. Both carry `attempts`, `lastError`, and `context`.

`PollPredicateMismatchError` carries `lastValue`, the most recent value that failed the predicate. It is what `pollUntil` throws internally on each unsatisfied round, so it usually reaches you as the `lastError` inside a timeout, which is where you look to find out what the status actually was when time ran out.

`operationContext` prefixes error messages with `[context] `, and carries through `pollUntil` to whichever error ends up being thrown. With several polls in one test it is the difference between `Retry operation timed out after 40 attempts` and `[order settle] Retry operation timed out after 40 attempts`. A missing or whitespace-only context is omitted rather than producing an empty `[]`.
