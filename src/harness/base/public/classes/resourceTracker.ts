import ResourceCleanupError from '../errors/resourceCleanupError.js';
import type TrackedResource from '../../private/interfaces/trackedResource.js';
import type ResourceCleanupFailure from '../interfaces/resourceCleanupFailure.js';

/**
 * Tracks resources created or modified during a single test so they can be reliably restored afterward, regardless
 * of whether the test passed or failed. Cleanup runs in last-in-first-out order so resources are undone in the
 * reverse order they were created, and a failing cleanup never prevents the remaining ones from being attempted.
 */
export default class ResourceTracker {
    /** Stack of tracked resources awaiting cleanup, in the order they were registered. */
    private readonly tracked: TrackedResource[] = [];

    /** Name of the test this tracker is scoped to. Used only for diagnostics. */
    private readonly testName: string;

    /**
     * Creates a resource tracker scoped to a single test.
     * @param testName Name of the test this tracker instance belongs to, used for diagnostic output.
     */
    constructor(testName: string) {
        this.testName = testName;
    }

    /**
     * Registers a resource that was created or modified during the test, along with the action required to
     * restore or delete it. Call this immediately after the mutation succeeds so cleanup is guaranteed even if a
     * later step in the test throws.
     * @param description Human readable description of the resource (e.g. `Entra group ${id}`), used in diagnostics.
     * @param cleanup Action that reverses or removes the resource. Must tolerate the resource already being gone.
     */
    track(description: string, cleanup: () => void | Promise<void>): void {
        this.tracked.push({
            description,
            cleanup
        });
    }

    /**
     * Returns a snapshot of the resources currently tracked (not yet cleaned up), for diagnostic reporting.
     * @returns Read only list of descriptions for tracked resources, in registration order.
     */
    getTrackedDescriptions(): readonly string[] {
        return this.tracked.map((resource) => resource.description);
    }

    /**
     * Runs cleanup for every tracked resource in reverse (LIFO) order. Never aborts early: a failing cleanup is
     * captured and the remaining resources are still attempted, so one broken cleanup can't strand the rest.
     * Failed resources remain tracked and can be retried by calling this method again.
     * @throws {ResourceCleanupError} When one or more cleanup actions fail, after all cleanups have been attempted.
     */
    async cleanupAll(): Promise<void> {
        /** Failures captured while attempting each cleanup, so a single bad cleanup can't strand the rest. */
        const failures: ResourceCleanupFailure[] = [];

        /** Resources whose cleanup failed and must remain available for a later retry. */
        const unresolvedResources: TrackedResource[] = [];

        while (this.tracked.length > 0) {
            /** Next resource to clean up, taken from the end of the stack so cleanup runs in LIFO order. */
            const resource = this.tracked.pop();

            if (!resource) { continue; }

            try {
                await resource.cleanup();
            } catch (error) {
                failures.push({
                    'description': resource.description,
                    error
                });

                unresolvedResources.push(resource);
            }
        }

        this.tracked.push(...unresolvedResources.reverse());

        if (failures.length > 0) {
            throw new ResourceCleanupError(failures, this.testName);
        }
    }
}
