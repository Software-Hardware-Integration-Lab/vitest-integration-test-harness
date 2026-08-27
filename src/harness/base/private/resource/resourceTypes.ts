import type { ResourceFailure } from '../../public/resource/resourceTypes.js';

/**
 * Describes a resource that is tracked by the test harness, including the actions required to create and clean it up.
 */
export interface ITrackedResource<T> {
    /** Human-readable description of the resource, used in diagnostics and cleanup error messages. */
    'description': string;

    /** Performs the cleanup/restoration for this specific resource. Must tolerate the resource already being gone. */
    'cleanup': (resource: T) => void | Promise<void>

    /** The result of the setup action, if it has completed. */
    'setupResult'?: T;

    /** The error raised during setup, if it failed. */
    'setupError'?: ResourceFailure;

    /** The error raised during cleanup, if it failed. */
    'cleanupError'?: ResourceFailure;
}

/**
 * Tracks resources created or modified during a test, along with the actions required to restore or delete them.
 * Resources are cleaned up in reverse order they were created, and a failing cleanup never prevents the remaining
 * ones from being attempted.
 */
export type ResourceDeclaration = 'undecided' | 'no-resources' | 'resources';
