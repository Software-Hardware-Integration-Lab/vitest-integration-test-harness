/** Describes a single cleanup action that failed, captured while attempting to restore all tracked resources. */
export default interface ResourceCleanupFailure {
    /** Description of the resource whose cleanup failed. */
    'description': string;
    /** The error raised while attempting cleanup. */
    'error': unknown;
}
