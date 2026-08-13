/* eslint-disable no-console -- Diagnostic output is the entire purpose of this module; only ever emitted on test failure. */
import type { TestContext } from 'vitest';
import type DiagnosticEntry from '../../public/interfaces/diagnosticEntry.js';
import type DiagnosticRedactionRule from '../../public/interfaces/diagnosticRedactionRule.js';
import type DiagnosticReporter from '../../public/interfaces/diagnosticReporter.js';
import type FailureDiagnosticsPayload from '../../public/interfaces/failureDiagnosticsPayload.js';

/** Replacement for a diagnostic value whose property name matches a redaction rule. */
const redactedValue = '[REDACTED]';

/** Sensitive property names commonly found in integration-test request and configuration data. */
const defaultRedactionRules: readonly RegExp[] = [
    /authorization/iu,
    /api[-_]?key/iu,
    /connection[-_]?string/iu,
    /password/iu,
    /secret/iu,
    /token/iu,
    /credential/iu
];

/**
 * Returns whether a property name matches a built-in or suite-provided redaction rule.
 * @param key Property name to evaluate.
 * @param rules Suite-provided property-name rules.
 * @returns Whether the property value should be redacted.
 */
function isSensitiveKey(key: string, rules: readonly DiagnosticRedactionRule[]): boolean {
    return [...defaultRedactionRules, ...rules].some((rule) => {
        if (typeof rule === 'string') {
            return rule.toLowerCase() === key.toLowerCase();
        }

        rule.lastIndex = 0;

        return rule.test(key);
    });
}

/**
 * Recursively copies a diagnostic value while replacing values held by sensitive properties.
 * @param value Value to sanitize.
 * @param rules Suite-provided property-name rules.
 * @param seen Previously copied objects, used to preserve circular references.
 * @returns A recursively sanitized copy of the input value.
 */
function sanitizeDiagnosticValue(value: unknown, rules: readonly DiagnosticRedactionRule[], seen = new WeakMap<object, unknown>()): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;

    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        return value instanceof Error
            ? {
                'name': value.name,
                'message': value.message,
                'stack': value.stack
            }
            : '[Non-plain diagnostic value]';
    }

    const existingSanitizedValue = seen.get(value);

    if (existingSanitizedValue !== void 0) {
        return existingSanitizedValue;
    }

    const sanitizedValue = (Array.isArray(value) ? [] : {}) as Record<string, unknown>;

    seen.set(value, sanitizedValue);

    for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);

        if (isSensitiveKey(key, rules)) {
            sanitizedValue[key] = redactedValue;
        } else if (descriptor !== void 0 && 'value' in descriptor) {
            sanitizedValue[key] = sanitizeDiagnosticValue(descriptor.value, rules, seen);
        } else {
            sanitizedValue[key] = '[Accessor diagnostic value]';
        }
    }

    return sanitizedValue;
}

/**
 * Collects diagnostic context during a test and only prints it when the test actually fails, so passing tests stay
 * quiet. Intended to be wired up as a harness fixture (see `lifecycle.ts`) rather than constructed directly by
 * individual suites.
 */
export default class DiagnosticsRecorder {
    /** Ordered list of diagnostic entries recorded so far during the current test. */
    readonly #entries: DiagnosticEntry[] = [];

    /** Name of the test this recorder is scoped to. */
    readonly #testName: string;

    /** Additional reporters registered by the test to receive failure diagnostics. */
    readonly #reporters: DiagnosticReporter[] = [];

    /** Suite-provided property-name rules for values that must be redacted. */
    readonly #redactionRules: DiagnosticRedactionRule[] = [];

    /**
     * Creates a diagnostics recorder scoped to a single test.
     * @param testName Name of the test this recorder instance belongs to.
     */
    constructor(testName: string) {
        this.#testName = testName;
    }

    /**
     * Records diagnostic context, retaining values until failure emission so later rules still apply.
     * @param label Short label identifying what this entry describes.
     * @param detail Arbitrary detail to capture.
     */
    record(label: string, detail: unknown): void {
        this.#entries.push({
            label,
            detail
        });
    }

    /**
     * Adds property-name rules for diagnostic values that must be redacted before they are emitted.
     * @param rules Property-name rules to add for the current test's diagnostics.
     */
    addRedactionRules(rules: readonly DiagnosticRedactionRule[]): void {
        this.#redactionRules.push(...rules);
    }

    /**
     * Registers a reporter that receives the current test's diagnostics if the test fails.
     * @param reporter Reporter invoked after the harness captures the failure diagnostics.
     */
    addReporter(reporter: DiagnosticReporter): void {
        this.#reporters.push(reporter);
    }

    /**
     * Prints every recorded diagnostic entry for a failed test. Wired up automatically by the harness's
     * `onTestFailed` hook; suites should not normally need to call this directly.
     * @param context The failed test's context, used to report the test name and underlying failure errors.
     */
    flush(context: TestContext): void {
        /** Human readable failure messages extracted from the test's recorded errors, if any. */
        const failureMessages = (context.task.result?.errors ?? []).map((error) => error.message);

        /** Structured diagnostic payload printed alongside the failure header. */
        const payload: FailureDiagnosticsPayload = {
            failureMessages,
            'recordedContext': this.#entries.map(({ label, detail }) => ({
                label,
                'detail': sanitizeDiagnosticValue(detail, this.#redactionRules)
            }))
        };

        console.error(`\n[Integration Test Failure Diagnostics] ${ this.#testName }`, payload);

        for (const reporter of this.#reporters) {
            reporter.report(payload);
        }
    }
}
