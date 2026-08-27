import type { ResourceFailure } from '../../public/resource/resourceTypes.js';
import type { ITrackedResource } from './resourceTypes.js';

/** A resource tracked through setup and cleanup. */
export class TrackedResource<T> implements ITrackedResource<T> {
    constructor(
        public readonly description: string,
        public readonly cleanup: (resource: T) => void | Promise<void>
    ) { }

    #cleanupError: ResourceFailure | undefined;

    get cleanupError(): ResourceFailure | undefined {
        return this.#cleanupError;
    }

    set cleanupError(error: ResourceFailure | undefined) {
        if (this.#cleanupError) {
            throw new Error(`Cannot set cleanupError for '${ this.description }' because it has already been set.`);
        }

        this.#cleanupError = error;
    }

    #setupError: ResourceFailure | undefined;

    get setupError(): ResourceFailure | undefined {
        return this.#setupError;
    }

    set setupError(error: ResourceFailure | undefined) {
        if (this.#setupError) {
            throw new Error(`Cannot set setupError for '${ this.description }' because it has already been set.`);
        }

        this.#setupError = error;
    }

    setupResult?: T;
}
