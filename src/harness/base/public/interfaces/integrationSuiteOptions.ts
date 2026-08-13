import type IntegrationSuiteContext from './integrationSuiteContext.js';

/** Configuration for a file-scoped integration suite lifecycle. */
export default interface IntegrationSuiteOptions {
    /** Human-readable suite name included in shared resource cleanup failures. */
    'name': string;
    /** Prepares shared suite state and returns its required paired cleanup action. */
    'setup': (context: IntegrationSuiteContext) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>;
}
