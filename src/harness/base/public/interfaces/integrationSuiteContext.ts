import type ResourceTracker from '../classes/resourceTracker.js';

/** File-scoped resources available while an integration suite prepares shared state. */
export default interface IntegrationSuiteContext {
    /** Tracks every shared mutation so it is restored after the suite completes. */
    'resources': ResourceTracker;
}
