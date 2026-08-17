/**
 * Represents an error that has scope/context information attached to it.
 */
export abstract class ScopedError extends Error {
    protected constructor(message: string, context?: string) {
        const errorMessage = context ? `[${ context }] ${ message }` : message;

        super(errorMessage);
    }
}
