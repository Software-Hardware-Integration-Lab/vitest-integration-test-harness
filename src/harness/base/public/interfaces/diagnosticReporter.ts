import type FailureDiagnosticsPayload from './failureDiagnosticsPayload.js';

/** Receives diagnostic data after an integration test fails. */
export default interface DiagnosticReporter {
    /**
     * Reports diagnostic data for the failed test.
     * @param payload Diagnostic data captured by the harness.
     */
    report(payload: FailureDiagnosticsPayload): void;
}
