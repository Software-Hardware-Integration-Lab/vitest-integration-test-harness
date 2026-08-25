# Failure Diagnostics

The context you need to debug a failing integration test is context you had while the test was running: the request you sent, the identifier the service handed back, how many times you polled. Printing it unconditionally means wading through it on every green run. Printing it nowhere means reproducing the failure by hand.

The `diagnostics` fixture records context as the test runs and emits it only if the test fails.

## Recording context

```ts no-check
diagnostics.record('created order', order);
diagnostics.record('poll attempts', settled.attempts);
```

Recording is cheap and silent. A passing test prints nothing, so you can record freely rather than rationing it to the places you suspect.

When the test fails, everything recorded goes to `console.error` under a header naming the test, alongside the failure messages Vitest collected.

## Sensitive values are redacted

Values are redacted by property name, not by inspecting the value. Seven names are covered out of the box, matched case-insensitively: `authorization`, `apiKey`, `connectionString`, `password`, `secret`, `token`, and `credential`. The two compound names also accept a hyphen or underscore, so `api_key` and `connection-string` match too.

Redaction is recursive, so a token nested three objects deep inside a recorded request is still replaced with `[REDACTED]`.

**These are exact-name matches, and that is the part to watch.** A property named `token` is redacted. A property named `accessToken`, `bearerToken`, or `refreshToken` is **not**, because the built-in rules anchor to the whole property name. If your objects use compound names, and most do, add rules for them:

```ts no-check
diagnostics.addRedactionRules(['accessToken', /token$/iu]);
```

String rules match a whole property name case-insensitively. Regular expressions are tested against the property name, so use them for the pattern cases.

Rules apply retroactively. Entries are held unsanitized until the test actually fails, so a rule added at the end of a test still covers something recorded at the beginning. You do not have to declare redaction before the code that records.

## How values are represented

Plain objects and arrays are copied recursively, and circular references survive the copy rather than blowing the stack.

Anything else is summarized rather than serialized. An `Error` becomes its name, message, and stack. Any other class instance becomes the string `[Non-plain diagnostic value]`, and a getter becomes `[Accessor diagnostic value]`.

That last pair is a real limitation rather than a formality. Recording a service client, a response object from an HTTP library, or anything else with a prototype gets you a placeholder instead of data. Record the plain fields you care about:

```ts no-check
diagnostics.record('response', {
    'status': response.status,
    'requestId': response.headers.get('x-request-id')
});
```

## Sending diagnostics somewhere else

A reporter receives the same payload the harness prints, which is useful for attaching failure context to a CI run or a log aggregator.

```ts no-check
diagnostics.addReporter({
    report: (payload): void => {
        writeFailureArtifact(payload.failureMessages, payload.recordedContext);
    }
});
```

Reporters run after the harness has captured the failure. A reporter that throws is caught and logged, and does not turn into a second test failure. A broken log shipper should not change whether your suite passes.

## Suppressing details in CI

Set `VITEST_INTEGRATION_HARNESS_ERROR_DETAILS=none` to replace Vitest's failure messages and any recorded `Error` message and stack with `[SUPPRESSED]`. Recorded context is still emitted, still redacted.

This exists for environments where build logs are broadly readable and an exception message might carry something from a live system. The default keeps details, since local debugging is the common case and losing the error message there is worse than useless.
