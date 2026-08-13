/**
 * Represents the result of a polling operation, including the final value obtained, the number of attempts made, and the total elapsed time in milliseconds.
 * @template T The type of the value returned by the polling operation.
 */
export interface PollResult<T> {
    'value': T;
    'attempts': number;
    'elapsedMs': number;
}
