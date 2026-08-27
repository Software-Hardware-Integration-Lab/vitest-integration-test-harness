import type { ResourceFailure } from './resourceTypes.js';
import { type ResourceDeclaration } from '../../private/resource/resourceTypes.js';
import { TrackedResource } from '../../private/resource/trackedResource.js';
import ResourceCleanupError from './errors/resourceCleanupError.js';
import ResourceSetupError from './errors/resourceSetupError.js';

/**
 * Tracks resources created or modified during a single test so they can be reliably restored afterward, regardless
 * of whether the test passed or failed. Cleanup runs in last-in-first-out order so resources are undone in the
 * reverse order they were created, and a failing cleanup never prevents the remaining ones from being attempted.
 */
export default class ResourceTracker {
    /** Stack of tracked resources awaiting cleanup, in the order they were registered. */
    readonly #tracked: TrackedResource<unknown>[] = [];

    /** Name of the test this tracker is scoped to. Used only for diagnostics. */
    readonly #testName: string;

    /** Cancels setup actions that have not started after a setup failure. */
    readonly #abortController: AbortController;

    /** Tracks whether the test has declared that it will create or modify resources. */
    #declaration: ResourceDeclaration = 'undecided';

    /**
     * Creates a resource tracker scoped to a single test.
     * @param testName Name of the test this tracker instance belongs to, used for diagnostic output.
     * @param abortSignal Optional external signal that cancels resource setup.
     */
    constructor(testName: string, abortSignal?: AbortSignal) {
        this.#testName = testName;

        this.#abortController = new AbortController();

        if (abortSignal) {
            if (abortSignal.aborted) {
                this.#abortController.abort(abortSignal.reason);
            } else {
                abortSignal.addEventListener('abort', () => {
                    this.#abortController.abort(abortSignal.reason);
                }, { 'once': true });
            }
        }
    }

    async track<T extends object = object>(
        description: string,
        setup: (signal: AbortSignal) => Promise<T>,
        cleanup: (resource: T) => void | Promise<void>
    ): Promise<T> {
        if (this.#declaration === 'no-resources') {
            throw new Error(`Cannot track '${ description }' after markNoResources() was called.`);
        }

        if (this.#abortController.signal.aborted) {
            const abortReason = this.#abortController.signal.reason as unknown;

            throw new ResourceSetupError([
                {
                    description,
                    'error': abortReason instanceof Error
                        ? abortReason
                        : new Error('Resource setup was aborted.', { 'cause': abortReason })
                }
            ], this.#testName);
        }

        this.#declaration = 'resources';

        const resource: TrackedResource<T> = new TrackedResource<T>(description, cleanup);

        let setupResult: T;

        try {
            setupResult = await setup(this.#abortController.signal);

            resource.setupResult = setupResult;
        } catch (error: unknown) {
            resource.setupError = {
                'description': resource.description,
                error
            };

            this.#abortController.abort(error);

            throw new ResourceSetupError([resource.setupError], this.#testName);
        }

        this.#register(resource);

        return setupResult;
    }

    /**
     * Registers cleanup owned by the harness, without changing the consumer's resource declaration.
     * @param description Human-readable description of the harness-owned cleanup.
     * @param cleanup Cleanup action to register.
     */
    registerCleanup(description: string, cleanup: () => void | Promise<void>): void {
        this.#register(new TrackedResource<void>(description, cleanup));
    }

    /**
     * Adds a successfully setup resource to the cleanup stack.
     * @param resource Successfully setup resource to register.
     */
    #register<T>(resource: TrackedResource<T>): void {
        this.#tracked.push(resource as TrackedResource<unknown>);
    }

    /**
     * Asserts that the test has declared whether it will create or modify resources. If not, throws an error
     * instructing the test to call track(...) or markNoResources().
     */
    assertDeclared(): void {
        if (this.#declaration === 'undecided') {
            throw new Error(`Integration run '${ this.#testName }' must call ` +
                'resources.track(...) or resources.markNoResources().');
        }
    }

    /**
     * Returns a snapshot of the resources currently tracked (not yet cleaned up), for diagnostic reporting.
     * @returns Read only list of descriptions for tracked resources, in registration order.
     */
    getTrackedDescriptions(): readonly string[] {
        return this.#tracked.map((resource) => resource.description);
    }

    /**
     * Runs cleanup for every tracked resource in reverse (LIFO) order. Never aborts early: a failing cleanup is
     * captured and the remaining resources are still attempted, so one broken cleanup can't strand the rest.
     * Failed resources remain tracked and can be retried by calling this method again.
     * @throws {ResourceCleanupError} When one or more cleanup actions fail, after all cleanups have been attempted.
     */
    async cleanupAll(): Promise<void> {
        /** Failures captured while attempting each cleanup, so a single bad cleanup can't strand the rest. */
        const failures: ResourceFailure[] = [];

        /** Resources whose cleanup failed and must remain available for a later retry. */
        const unresolvedResources: TrackedResource<unknown>[] = [];

        while (this.#tracked.length > 0) {
            /** Next resource to clean up, taken from the end of the stack so cleanup runs in LIFO order. */
            const resource = this.#tracked.pop();

            if (!resource) { continue; }

            try {
                await resource.cleanup(resource.setupResult);
            } catch (error) {
                failures.push({
                    'description': resource.description,
                    error
                });

                unresolvedResources.push(resource);
            }
        }

        this.#tracked.push(...unresolvedResources.reverse());

        if (failures.length > 0) {
            throw new ResourceCleanupError(failures, this.#testName);
        }
    }

    /**
     * Marks the test as having no resources to track. If the test later calls track(...), an error is thrown.
     */
    markNoResources(): void {
        if (this.#declaration === 'resources') {
            throw new Error('Cannot call markNoResources() after resources have been tracked.');
        }

        this.#declaration = 'no-resources';
    }
}
