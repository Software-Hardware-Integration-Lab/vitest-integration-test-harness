/**
 * Determine whether a value can contain nested properties that should be traversed.
 * @param value - The value to inspect.
 * @returns `true` when the value is an object or function.
 */
function isFreezable(value: unknown): value is Record<string, unknown> {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
}

/**
 * Detect whether an object graph contains a circular reference.
 * @param obj - The value to inspect.
 * @param visiting - Objects currently being traversed in the active path.
 * @param visited - Objects that have already been checked and proven acyclic.
 * @returns `true` when the object graph contains a circular reference.
 */
export function isCyclicObject(
    obj: unknown,
    visiting: WeakSet<Record<string, unknown>> = new WeakSet<Record<string, unknown>>(),
    visited: WeakSet<Record<string, unknown>> = new WeakSet<Record<string, unknown>>()
): boolean {
    if (!isFreezable(obj)) { return false; }

    if (visiting.has(obj)) { return true; }

    if (visited.has(obj)) { return false; }

    visiting.add(obj);

    for (const key of Object.getOwnPropertyNames(obj)) {
        /** The value of the accessed property. */
        const nested = obj[key];

        if (isFreezable(nested) && isCyclicObject(nested, visiting, visited)) {
            return true;
        }
    }

    visiting.delete(obj);

    visited.add(obj);

    return false;
}

/**
 * Recursively freezes an object and all of its properties to make them immutable.
 * @param value - The object to deep freeze.
 * @returns A readonly version of the object.
 * @throws {TypeError} Thrown when a circular reference is detected.
 */
export default function deepFreeze<T>(value: T): Readonly<T> {
    if (!isFreezable(value)) { return value; }

    if (isCyclicObject(value)) {
        throw new TypeError('Cannot deep freeze circular reference');
    }

    Object.getOwnPropertyNames(value).forEach((key) => {
        /** The value of the accessed property. */
        const nested = value[key];

        if (isFreezable(nested)) {
            deepFreeze(nested);
        }
    });

    return Object.freeze(value);
}
