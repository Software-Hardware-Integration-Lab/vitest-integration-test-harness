import type DiagnosticEntry from './diagnosticEntry.js';

/** Diagnostic data emitted after an integration test fails. */
export default interface FailureDiagnosticsPayload {
    /** Human readable failure messages extracted from Vitest's recorded errors. */
    'failureMessages': readonly string[];
    /** Every diagnostic entry recorded during the test, in recording order. */
    'recordedContext': readonly DiagnosticEntry[];
}
