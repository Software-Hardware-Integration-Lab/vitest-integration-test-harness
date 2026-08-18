import { describe, expect, test } from 'vitest';
import deepFreeze, { isCyclicObject } from '../src/utilities/private/modules/deepFreeze.js';

void describe('deepFreeze', () => {
    test('does not detect a circular reference in primitive values', () => {
        expect(isCyclicObject('value')).toBe(false);
    });

    test('freezes nested objects and arrays recursively', () => {
        const value = {
            'list': [{ 'id': 'item-1' }],
            'topLevel': {
                'nested': {
                    'enabled': true
                }
            }
        };

        const result = deepFreeze(value);

        expect(result).toBe(value);

        expect(Object.isFrozen(result)).toBe(true);

        expect(Object.isFrozen(result.topLevel)).toBe(true);

        expect(Object.isFrozen(result.topLevel.nested)).toBe(true);

        expect(Object.isFrozen(result.list)).toBe(true);

        expect(Object.isFrozen(result.list[0])).toBe(true);
    });

    test('returns primitive values unchanged', () => {
        expect(deepFreeze('value')).toBe('value');

        expect(deepFreeze(42)).toBe(42);

        // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
        expect(deepFreeze(void 0)).toBe(void 0);

        expect(deepFreeze(null)).toBe(null);
    });

    test('throws when detecting circular references', () => {
        interface A {
            'other'?: B;
        }
        interface B {
            'other'?: A;
        }

        const first: A = {
            'other': void 0
        };

        const second: B = {
            'other': first
        };

        first.other = second;

        expect(() => deepFreeze(first)).toThrow('Cannot deep freeze circular reference');
    });

    test('throws when detecting direct self references', () => {
        interface SelfReferencing {
            'self'?: SelfReferencing;
        }

        const value: SelfReferencing = {};

        value.self = value;

        expect(() => deepFreeze(value)).toThrow('Cannot deep freeze circular reference');
    });

    test('allows shared references that are not circular', () => {
        const shared = {
            'id': 'shared'
        };

        const value = {
            'left': shared,
            'right': shared
        };

        const result = deepFreeze(value);

        expect(result).toBe(value);

        expect(Object.isFrozen(result)).toBe(true);

        expect(Object.isFrozen(result.left)).toBe(true);

        expect(result.left).toBe(result.right);
    });
});
