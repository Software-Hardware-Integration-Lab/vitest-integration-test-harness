/**
 * A single tracked resource awaiting cleanup: a human-readable description plus the action that restores or
 * removes it.
 */
export default interface TrackedResource {
    /** Human-readable description of the resource, used in diagnostics and cleanup error messages. */
    'description': string;
    /** Performs the cleanup/restoration for this specific resource. Must tolerate the resource already being gone. */
    'cleanup': () => void | Promise<void>;
}
