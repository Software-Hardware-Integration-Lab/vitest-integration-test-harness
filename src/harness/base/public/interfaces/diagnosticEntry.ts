/** A labeled, serializable piece of context captured while an integration test runs. */
export default interface DiagnosticEntry {
    /** Short label identifying what this entry describes. */
    'label': string;
    /** Serializable detail captured at the time the entry was recorded. */
    'detail': unknown;
}
