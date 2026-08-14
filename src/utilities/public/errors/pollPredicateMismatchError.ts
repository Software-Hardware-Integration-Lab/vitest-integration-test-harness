/** Raised when a polling result does not satisfy its predicate. */
export class PollPredicateMismatchError<T> extends Error {
    constructor(public readonly lastValue: T) {
        super('Poll condition was not met.');

        this.name = 'PollPredicateMismatchError';
    }
}
