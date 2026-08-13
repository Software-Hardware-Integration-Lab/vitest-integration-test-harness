import type DiagnosticRedactionRule from './diagnosticRedactionRule.js';
import type DiagnosticReporter from './diagnosticReporter.js';

/** Records contextual data that the harness emits only if the current integration test fails. */
export default interface Diagnostics {
    /**
     * Records a labeled, serializable piece of diagnostic context for the current test.
     * @param label Short label identifying the recorded context.
     * @param detail Serializable detail to emit if the test fails.
     */
    record(label: string, detail: unknown): void;

    /**
     * Adds property-name rules for diagnostic values that must be redacted before they are retained or emitted.
     * String rules are matched case-insensitively; regular expressions are matched against each property name.
     * @param rules Property-name rules to add for the current test's diagnostics.
     */
    addRedactionRules(rules: readonly DiagnosticRedactionRule[]): void;

    /**
     * Registers a reporter that receives the current test's diagnostics if the test fails.
     * @param reporter Reporter invoked after the harness captures the failure diagnostics.
     */
    addReporter(reporter: DiagnosticReporter): void;
}
