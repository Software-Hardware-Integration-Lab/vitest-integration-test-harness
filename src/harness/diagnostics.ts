/* eslint-disable no-console -- Diagnostic output is the entire purpose of this module; only ever emitted on test failure. */
import type { TestContext } from 'vitest';

/** A single piece of contextual information captured during a test, surfaced only if the test ends up failing. */
interface DiagnosticEntry {
    /** Short label identifying what this entry describes (e.g. 'last request', 'graph response'). */
    'label': string;
    /** Arbitrary detail captured at the time the entry was recorded. Should be plain, serializable data. */
    'detail': unknown;
}

/** Shape of the diagnostic payload printed to `console.error` when a test fails. Documents the on-failure output contract for anything that asserts on it directly (e.g. the harness self-tests). */
export interface FailureDiagnosticsPayload {
    /** Human readable failure messages extracted from the test's recorded errors. */
    'failureMessages': readonly string[];
    /** Every diagnostic entry recorded via `record()` during the test, in recording order. */
    'recordedContext': readonly DiagnosticEntry[];
}

/**
 * Collects diagnostic context during a test and only prints it when the test actually fails, so passing tests stay
 * quiet. Intended to be wired up as a harness fixture (see `lifecycle.ts`) rather than constructed directly by
 * individual suites.
 */
export default class DiagnosticsRecorder {
    /** Ordered list of diagnostic entries recorded so far during the current test. */
    private readonly entries: DiagnosticEntry[] = [];

    /** Name of the test this recorder is scoped to. */
    private readonly testName: string;

    /**
     * Creates a diagnostics recorder scoped to a single test.
     * @param testName Name of the test this recorder instance belongs to.
     */
    constructor(testName: string) {
        this.testName = testName;
    }

    /**
     * Records a piece of diagnostic context. Cheap to call liberally since nothing is printed unless the test
     * fails. Avoid passing live handles or secrets - only plain, serializable data.
     * @param label Short label identifying what this entry describes.
     * @param detail Arbitrary detail to capture.
     */
    record(label: string, detail: unknown): void {
        this.entries.push({
            label,
            detail
        });
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
            'recordedContext': this.entries
        };

        console.error(`\n[Integration Test Failure Diagnostics] ${ this.testName }`, payload);
    }
}
