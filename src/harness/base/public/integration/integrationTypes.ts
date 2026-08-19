import type { EnvironmentReadiness } from '../environment/environmentTypes.js';
import type ResourceTracker from '../resource/resourceTracker.js';

/** File-scoped resources available while an integration suite prepares shared state. */
export interface IntegrationSuiteContext {
    /** Tracks every shared mutation so it is restored after the suite completes. */
    'resources': ResourceTracker;
}

/** Diagnostic data emitted after an integration test fails. */
export interface FailureDiagnosticsPayload {
    /** Human-readable failure messages extracted from Vitest's recorded errors. */
    'failureMessages': readonly string[];
    /** Every diagnostic entry recorded during the test, in recording order. */
    'recordedContext': readonly DiagnosticEntry[];
}

/** Receives diagnostic data after an integration test fails. */
export interface DiagnosticReporter {
    /**
     * Reports diagnostic data for the failed test.
     * @param payload Diagnostic data captured by the harness.
     */
    report(payload: FailureDiagnosticsPayload): void;
}

/** Records contextual data that the harness emits only if the current integration test fails. */
export interface Diagnostics {
    /**
     * Records a labeled diagnostic value for the current test. Arrays and plain objects are preserved recursively;
     * other object types are represented safely when diagnostics are emitted.
     * @param label Short label identifying the recorded context.
     * @param detail Detail to emit if the test fails.
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

/** Configuration for a file-scoped integration suite lifecycle. */
export interface IntegrationSuiteOptions {
    /** Human-readable suite name included in shared resource cleanup failures. */
    'name': string;
    /** Prepares shared suite state and returns its required paired cleanup action. */
    'setup': (context: IntegrationSuiteContext) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>;
}

/**
 * Fixtures provided by the `integrationTest` base test function. Suites that extend the base test with additional
 * fixtures should extend this interface to include their own fixtures.
 */
export interface IntegrationTestFixtures {
    /** Environment readiness result used by the automatic readiness gate. */
    'environment': EnvironmentReadiness;
    /** Automatic gate fixture; it has no exposed value and skips tests when the environment is not ready. */
    'readinessGate': undefined;
    /** Per-test tracker used to register resources for guaranteed LIFO cleanup. */
    'resources': ResourceTracker;
    /** Per-test recorder used to capture context that is printed only after a test failure. */
    'diagnostics': Diagnostics;
}

/** A labeled, serializable piece of context captured while an integration test runs. */
export interface DiagnosticEntry {
    /** Short label identifying what this entry describes. */
    'label': string;
    /** Serializable detail captured at the time the entry was recorded. */
    'detail': unknown;
}

/** Matches the name of a diagnostic property whose value must be redacted. */
export type DiagnosticRedactionRule = string | RegExp;
