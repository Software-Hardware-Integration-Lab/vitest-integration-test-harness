/** Describes a single cleanup action that failed, captured while attempting to restore all tracked resources. */
export interface ResourceFailure {
    /** Description of the resource. */
    'description': string;
    /** The error raised. */
    'error': unknown;
}
