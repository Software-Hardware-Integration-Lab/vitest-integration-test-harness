import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { type TestContext, afterEach, describe, expect, it, vi } from 'vitest';
import DiagnosticsRecorder from '../src/harness/base/private/diagnostics/diagnostics.js';
import { TrackedResource } from '../src/harness/base/private/resource/trackedResource.js';
import { runSuiteLifecycle } from '../src/harness/base/public/integration/integrationSuite.js';
import { runResourceTrackingLifecycle } from '../src/harness/base/public/integration/integrationTestLifecycle.js';
import {
    evaluateReadiness,
    integrationTest,
    ResourceCleanupError,
    ResourceSetupError,
    type EnvironmentReadiness,
    ResourceTracker, type FailureDiagnosticsPayload
} from '../src/index.js';

const unreadyIntegrationTest = integrationTest.extend<{
    '$file': {
        'environment': EnvironmentReadiness;
    };
}>({
    'environment': [
        // eslint-disable-next-line no-empty-pattern -- Vitest fixture functions require an object-destructured context.
        async ({ }, use): Promise<void> => {
            await use({
                'ready': false,
                'reason': 'fixture readiness failed'
            });
        },
        { 'scope': 'file' }
    ]
});

unreadyIntegrationTest('does not execute an unready integration test', () => {
    expect.unreachable('The readiness gate should skip this test.');
});

void describe('evaluateReadiness', () => {
    it('reports ready when every check passes', async () => {
        /** Result of evaluating a single always-passing readiness check. */
        const result = await evaluateReadiness([
            {
                'name': 'always true',
                /** @returns Always reports the check as passed. */
                'verify': (): boolean => true
            }
        ]);

        expect(result).toEqual({
            'ready': true,
            'reason': void 0
        });
    });

    it('stops at the first failing check and reports why, without running later checks', async () => {
        /** Spy used to prove a later check is never invoked once an earlier one has already failed. */
        const laterCheck = vi.fn(() => true);

        /** Result of evaluating a failing check followed by a check that should never run. */
        const result = await evaluateReadiness([
            {
                'name': 'fails',
                /** @returns Always reports the check as failed. */
                'verify': (): boolean => false
            },
            {
                'name': 'never reached',
                'verify': laterCheck
            }
        ]);

        expect(result.ready).toBe(false);

        expect(result.reason).toContain('fails');

        expect(laterCheck).not.toHaveBeenCalled();
    });

    it('treats a thrown error from a check as a failed check', async () => {
        /** Result of evaluating a check that throws instead of returning false. */
        const result = await evaluateReadiness([
            {
                'name': 'throws',
                /** Always throws instead of reporting a boolean result. */
                'verify': (): boolean => { throw new Error('boom'); }
            }
        ]);

        expect(result.ready).toBe(false);

        expect(result.reason).toContain('boom');
    });
});

void describe('ResourceTracker', () => {
    it('throws ResourceSetupError when setup fails and preserves prior resources for cleanup', async () => {
        const tracker = new ResourceTracker('unit-test');

        const cleanup = vi.fn();

        await tracker.track('first', (): Promise<object> => Promise.resolve({}), cleanup);

        try {
            await tracker.track('second', (): Promise<object> => Promise.reject(new Error('setup boom')), cleanup);

            expect.unreachable('Resource setup should have failed.');
        } catch (error) {
            expect(error).toBeInstanceOf(ResourceSetupError);

            const setupError = error as ResourceSetupError;

            expect(setupError.failures).toHaveLength(1);

            expect(setupError.failures[0]?.description).toBe('second');

            expect(setupError.failures[0]?.error).toBeInstanceOf(Error);

            expect((setupError.failures[0]?.error as Error).message).toBe('setup boom');
        }

        expect(tracker.getTrackedDescriptions()).toEqual(['first']);

        await tracker.cleanupAll();

        expect(cleanup).toHaveBeenCalledOnce();
    });

    it('aborts later setup after a setup failure', async () => {
        const tracker = new ResourceTracker('unit-test');

        await expect(tracker.track(
            'first',
            (): Promise<object> => Promise.reject(new Error('setup boom')),
            () => { /* No-op cleanup */ }
        )).rejects.toBeInstanceOf(ResourceSetupError);

        await expect(tracker.track(
            'second',
            // eslint-disable-next-line stylistic/no-confusing-arrow
            (signal): Promise<object> => signal.aborted
                ? Promise.reject(new Error('setup aborted'))
                : Promise.resolve({}),
            () => { /* No-op cleanup */ }
        )).rejects.toMatchObject({
            'name': 'ResourceSetupError',
            'failures': [{ 'description': 'second' }]
        });
    });

    it('cleans up tracked resources in reverse (LIFO) order', async () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        /** Records the order cleanup callbacks actually ran in. */
        const order: string[] = [];

        await tracker.track('first', (): Promise<object> => Promise.resolve({}), () => { order.push('first'); });

        await tracker.track('second', (): Promise<object> => Promise.resolve({}), () => { order.push('second'); });

        await tracker.cleanupAll();

        expect(order).toEqual(['second', 'first']);
    });

    it('attempts every cleanup even when one fails, and aggregates the failures', async () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        /** Spy proving the second cleanup still runs despite the first one throwing. */
        const secondCleanup = vi.fn();

        await tracker.track('will fail', (): Promise<object> => Promise.resolve({}), () => { throw new Error('cleanup boom'); });

        await tracker.track('will still run', (): Promise<object> => Promise.resolve({}), secondCleanup);

        await expect(tracker.cleanupAll()).rejects.toThrow(ResourceCleanupError);

        expect(secondCleanup).toHaveBeenCalledOnce();
    });

    it('exposes descriptions of resources and exceptions with failed cleanups', async () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        await tracker.track('will fail', (): Promise<object> => Promise.resolve({}), () => { throw new Error('cleanup boom'); });

        try {
            await tracker.cleanupAll();

            expect.unreachable('cleanup should have failed');
        } catch (error) {
            expect(error).toBeInstanceOf(ResourceCleanupError);

            const [failure] = (error as ResourceCleanupError).failures;

            expect(failure).toBeDefined();

            expect(failure!.description).toBe('will fail');

            expect(failure!.error).toBeInstanceOf(Error);

            expect((failure!.error as Error).message).toBe('cleanup boom');
        }
    });

    it('omits unavailable cleanup stacks and preserves the original error as the cause', () => {
        /** Cleanup error whose stack is unavailable, as can happen with errors from external libraries. */
        const cleanupError = new Error('cleanup boom');

        cleanupError.stack = void 0;

        /** Aggregate error constructed from the cleanup failure. */
        const error = new ResourceCleanupError([
            {
                'description': 'will fail',
                'error': cleanupError
            }
        ], 'unit-test');

        expect(error.message).toContain('will fail: cleanup boom');

        expect(error.message).not.toContain('undefined');

        expect(error.cause).toBe(cleanupError);

        expect(error.failures).toEqual([
            {
                'description': 'will fail',
                'error': cleanupError
            }
        ]);
    });

    it('formats non-Error cleanup failures and multiple cleanup actions', () => {
        const error = new ResourceCleanupError([
            {
                'description': 'first resource',
                'error': 'cleanup rejected'
            },
            {
                'description': 'second resource',
                'error': 500
            }
        ], 'unit-test');

        expect(error.message).toContain('2 resource cleanup actions failed');

        expect(error.message).toContain('first resource: cleanup rejected');

        expect(error.message).toContain('second resource: 500');
    });

    it('exposes descriptions of resources still tracked', async () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        await tracker.track('alpha', (): Promise<object> => Promise.resolve({}), () => { /* No-op cleanup */ });

        await tracker.track('beta', (): Promise<object> => Promise.resolve({}), () => { /* No-op cleanup */ });

        expect(tracker.getTrackedDescriptions()).toEqual(['alpha', 'beta']);
    });

    it('retains failed cleanups so a later cleanup can retry them', async () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        /** Counts cleanup attempts to simulate a transient eventual-consistency failure. */
        let attempts = 0;

        await tracker.track('eventually consistent resource', (): Promise<object> => Promise.resolve({}), () => {
            attempts += 1;

            if (attempts === 1) {
                throw new Error('resource is not ready for cleanup');
            }
        });

        await expect(tracker.cleanupAll()).rejects.toThrow(ResourceCleanupError);

        expect(tracker.getTrackedDescriptions()).toEqual(['eventually consistent resource']);

        await tracker.cleanupAll();

        expect(attempts).toBe(2);

        expect(tracker.getTrackedDescriptions()).toEqual([]);
    });

    it('immediately fails setup when constructed with an already-aborted external signal', async () => {
        const controller = new AbortController();

        controller.abort(new Error('external abort'));

        const tracker = new ResourceTracker('unit-test', controller.signal);

        await expect(tracker.track(
            'first',
            (): Promise<object> => Promise.resolve({}),
            () => { /* No-op cleanup */ }
        )).rejects.toBeInstanceOf(ResourceSetupError);
    });

    it('wraps a non-Error abort reason in a new Error when setup is already aborted', async () => {
        const controller = new AbortController();

        controller.abort('non-error abort reason');

        const tracker = new ResourceTracker('unit-test', controller.signal);

        try {
            await tracker.track('first', (): Promise<object> => Promise.resolve({}), () => { /* No-op cleanup */ });

            expect.unreachable('Resource setup should have failed.');
        } catch (error) {
            expect(error).toBeInstanceOf(ResourceSetupError);

            const setupError = error as ResourceSetupError;

            expect(setupError.failures[0]?.error).toBeInstanceOf(Error);

            expect((setupError.failures[0]?.error as Error).message).toBe('Resource setup was aborted.');

            expect((setupError.failures[0]?.error as Error).cause).toBe('non-error abort reason');
        }
    });

    it('propagates a later external abort signal to in-flight setup', async () => {
        const controller = new AbortController();

        const tracker = new ResourceTracker('unit-test', controller.signal);

        /** Setup that only rejects once the tracker's internal signal is aborted. */
        const trackPromise = tracker.track(
            'first',
            (signal): Promise<object> => new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => { reject(new Error('setup aborted')); }, { 'once': true });
            }),
            () => { /* No-op cleanup */ }
        );

        controller.abort(new Error('external abort arrived later'));

        await expect(trackPromise).rejects.toBeInstanceOf(ResourceSetupError);
    });

    it('throws when track() is called after markNoResources()', async () => {
        const tracker = new ResourceTracker('unit-test');

        tracker.markNoResources();

        await expect(tracker.track(
            'late resource',
            (): Promise<object> => Promise.resolve({}),
            () => { /* No-op cleanup */ }
        )).rejects.toThrow(/after markNoResources\(\) was called/u);
    });

    it('assertDeclared throws when neither track() nor markNoResources() was called', () => {
        const tracker = new ResourceTracker('unit-test');

        expect(() => { tracker.assertDeclared(); }).toThrow(/must call/u);
    });

    it('assertDeclared does not throw after markNoResources()', () => {
        const tracker = new ResourceTracker('unit-test');

        tracker.markNoResources();

        expect(() => { tracker.assertDeclared(); }).not.toThrow();
    });

    it('throws when markNoResources() is called after resources have been tracked', async () => {
        const tracker = new ResourceTracker('unit-test');

        await tracker.track('first', (): Promise<object> => Promise.resolve({}), () => { /* No-op cleanup */ });

        expect(() => { tracker.markNoResources(); }).toThrow(/Cannot call markNoResources/u);
    });

    it('registerCleanup adds harness-owned cleanup without satisfying the declaration', async () => {
        const tracker = new ResourceTracker('unit-test');

        const cleanup = vi.fn();

        tracker.registerCleanup('harness-owned cleanup', cleanup);

        expect(() => { tracker.assertDeclared(); }).toThrow(/must call/u);

        await tracker.cleanupAll();

        expect(cleanup).toHaveBeenCalledOnce();
    });
});

void describe('TrackedResource', () => {
    it('starts with no setup result or errors', () => {
        const resource = new TrackedResource<object>('a resource', () => { /* No-op cleanup */ });

        expect(resource.description).toBe('a resource');

        expect(resource.setupResult).toBeUndefined();

        expect(resource.setupError).toBeUndefined();

        expect(resource.cleanupError).toBeUndefined();
    });

    it('stores and retrieves a setup result', () => {
        const resource = new TrackedResource<{ 'value': number }>('a resource', () => { /* No-op cleanup */ });

        resource.setupResult = { 'value': 42 };

        expect(resource.setupResult).toEqual({ 'value': 42 });
    });

    it('stores and retrieves a setup error once', () => {
        const resource = new TrackedResource<object>('a resource', () => { /* No-op cleanup */ });

        const failure = {
            'description': 'a resource',
            'error': new Error('setup boom')
        };

        resource.setupError = failure;

        expect(resource.setupError).toBe(failure);
    });

    it('throws when setupError is set a second time', () => {
        const resource = new TrackedResource<object>('a resource', () => { /* No-op cleanup */ });

        resource.setupError = {
            'description': 'a resource',
            'error': new Error('first')
        };

        expect(() => {
            resource.setupError = {
                'description': 'a resource',
                'error': new Error('second')
            };
        }).toThrow(/setupError for 'a resource' because it has already been set/u);
    });

    it('stores and retrieves a cleanup error once', () => {
        const resource = new TrackedResource<object>('a resource', () => { /* No-op cleanup */ });

        const failure = {
            'description': 'a resource',
            'error': new Error('cleanup boom')
        };

        resource.cleanupError = failure;

        expect(resource.cleanupError).toBe(failure);
    });

    it('throws when cleanupError is set a second time', () => {
        const resource = new TrackedResource<object>('a resource', () => { /* No-op cleanup */ });

        resource.cleanupError = {
            'description': 'a resource',
            'error': new Error('first')
        };

        expect(() => {
            resource.cleanupError = {
                'description': 'a resource',
                'error': new Error('second')
            };
        }).toThrow(/cleanupError for 'a resource' because it has already been set/u);
    });
});

void describe('runResourceTrackingLifecycle', () => {
    it('runs cleanup and returns normally when the test body declares no resources', async () => {
        await expect(runResourceTrackingLifecycle('unit-test', (tracker) => {
            tracker.markNoResources();

            return Promise.resolve();
        })).resolves.toBeUndefined();
    });

    it('throws only the test body failure when cleanup succeeds', async () => {
        const cleanup = vi.fn();

        await expect(runResourceTrackingLifecycle('unit-test', async (tracker) => {
            await tracker.track('resource', (): Promise<object> => Promise.resolve({}), cleanup);

            throw new Error('test body failed');
        })).rejects.toThrow('test body failed');

        expect(cleanup).toHaveBeenCalledOnce();
    });

    it('throws only the cleanup failure when the test body succeeds', async () => {
        await expect(runResourceTrackingLifecycle('unit-test', async (tracker) => {
            await tracker.track('resource', (): Promise<object> => Promise.resolve({}), () => {
                throw new Error('cleanup failed');
            });
        })).rejects.toThrow(ResourceCleanupError);
    });

    it('throws an AggregateError when the test body and cleanup both fail', async () => {
        await expect(runResourceTrackingLifecycle('unit-test', async (tracker) => {
            await tracker.track('resource', (): Promise<object> => Promise.resolve({}), () => {
                throw new Error('cleanup failed');
            });

            throw new Error('test body failed');
        })).rejects.toBeInstanceOf(AggregateError);
    });

    it('throws when the test body succeeds but never declares resources', async () => {
        await expect(runResourceTrackingLifecycle('unit-test', () => Promise.resolve()))
            .rejects.toThrow(/must call/u);
    });

    it('wraps a non-Error test body failure in a new Error', async () => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Exercises the non-Error wrapping branch.
        await expect(runResourceTrackingLifecycle('unit-test', () => Promise.reject('non-error failure')))
            .rejects.toThrow('non-error failure');
    });
});

void describe('runSuiteLifecycle', () => {
    function noopSetup(): () => void {
        return (): void => { /* No-op cleanup */ };
    }

    it('skips setup and cleanup entirely when the environment is not ready', async () => {
        const use = vi.fn(() => Promise.resolve());

        await runSuiteLifecycle({
            'name': 'unready suite',
            'setup': noopSetup
        }, false, use);

        expect(use).toHaveBeenCalledOnce();
    });

    it('runs the file\'s tests after setup succeeds and declares no resources', async () => {
        const use = vi.fn(() => Promise.resolve());

        await runSuiteLifecycle({
            'name': 'ready suite',
            'setup': ({ resources }): () => void => {
                resources.markNoResources();

                return (): void => { /* No-op cleanup */ };
            }
        }, true, use);

        expect(use).toHaveBeenCalledOnce();
    });

    it('throws only the setup failure when no resources were tracked', async () => {
        await expect(runSuiteLifecycle({
            'name': 'failing setup',
            'setup': (): never => { throw new Error('setup failed'); }
        }, true, () => Promise.resolve())).rejects.toThrow('setup failed');
    });

    it('wraps a non-Error setup failure in a new Error', async () => {
        await expect(runSuiteLifecycle({
            'name': 'failing setup with non-error reason',
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises the non-Error wrapping branch.
            'setup': (): never => { throw 'non-error setup failure'; }
        }, true, () => Promise.resolve())).rejects.toThrow('non-error setup failure');
    });

    it('throws when setup succeeds but never declares resources', async () => {
        await expect(runSuiteLifecycle({
            'name': 'undeclared setup',
            'setup': (): () => void => (): void => { /* No-op cleanup */ }
        }, true, () => Promise.resolve())).rejects.toThrow(/must call/u);
    });

    it('throws only the cleanup failure when setup succeeds', async () => {
        await expect(runSuiteLifecycle({
            'name': 'failing cleanup',
            'setup': async ({ resources }): Promise<() => void> => {
                await resources.track('suite resource', (): Promise<object> => Promise.resolve({}), () => {
                    throw new Error('cleanup failed');
                });

                return (): void => { /* No-op cleanup */ };
            }
        }, true, () => Promise.resolve())).rejects.toThrow(ResourceCleanupError);
    });

    it('throws an AggregateError when setup and cleanup both fail', async () => {
        await expect(runSuiteLifecycle({
            'name': 'failing setup and cleanup',
            'setup': async ({ resources }): Promise<never> => {
                await resources.track('suite resource', (): Promise<object> => Promise.resolve({}), () => {
                    throw new Error('cleanup failed');
                });

                throw new Error('setup failed');
            }
        }, true, () => Promise.resolve())).rejects.toBeInstanceOf(AggregateError);
    });
});

void describe('DiagnosticsRecorder', () => {
    afterEach(() => {
        vi.restoreAllMocks();

        vi.unstubAllEnvs();
    });

    it('prints recorded context only when flushed', () => {
        /** Spy replacing `console.error` for the duration of this test so output can be asserted on. */
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        /** Recorder under test, scoped to a fake test name since this exercises the class directly. */
        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.record('note', { 'detail': 42 });

        /** Minimal fake test context, shaped just enough for `flush` to read a failure message from it. */
        const fakeContext = {
            'task': {
                'name': 'unit-test',
                'result': { 'errors': [{ 'message': 'expected failure' }] }
            }
        } as unknown as TestContext;

        recorder.flush(fakeContext);

        expect(consoleSpy).toHaveBeenCalledOnce();

        /** Rendered failure detail passed to `console.error`. */
        const [renderedDiagnostics] = consoleSpy.mock.calls[0] as [string];

        expect(renderedDiagnostics).toContain('expected failure');

        expect(renderedDiagnostics).toContain('label: \'note\'');

        expect(renderedDiagnostics).toContain('detail: 42');
    });

    it('emits an empty failure message list when Vitest reports no errors', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        const reporter = { 'report': vi.fn() };

        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.addReporter(reporter);

        recorder.flush({ 'task': {} } as unknown as TestContext);

        expect(reporter.report).toHaveBeenCalledWith(expect.objectContaining({ 'failureMessages': [] }));
    });

    it('suppresses error details when the CI diagnostics policy is enabled', () => {
        vi.stubEnv('VITEST_INTEGRATION_HARNESS_ERROR_DETAILS', 'none');

        vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        let capturedPayload: FailureDiagnosticsPayload | undefined;

        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.addReporter({
            'report': (payload: FailureDiagnosticsPayload): void => {
                capturedPayload = payload;
            }
        });

        const error = new Error('Bearer secret-token');

        error.stack = 'Error: Bearer secret-token';

        recorder.record('request failure', error);

        recorder.flush({
            'task': {
                'result': { 'errors': [{ 'message': 'Bearer secret-token' }] }
            }
        } as unknown as TestContext);

        expect(capturedPayload).toEqual({
            'failureMessages': ['[SUPPRESSED]'],
            'recordedContext': [
                {
                    'label': 'request failure',
                    'detail': {
                        'name': 'Error',
                        'message': '[SUPPRESSED]',
                        'stack': '[SUPPRESSED]'
                    }
                }
            ]
        });
    });

    it('passes the captured failure payload to registered reporters', () => {
        /** Spy replacing `console.error` so the expected diagnostic output does not reach the test runner. */
        vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        /** Reporter spy that receives the payload when the recorder flushes. */
        const reporter = { 'report': vi.fn() };

        /** Recorder under test, scoped to a fake test name since this exercises the class directly. */
        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.record('note', { 'detail': 42 });

        recorder.addReporter(reporter);

        /** Minimal fake test context, shaped just enough for `flush` to read a failure message from it. */
        const fakeContext = {
            'task': {
                'name': 'unit-test',
                'result': { 'errors': [{ 'message': 'expected failure' }] }
            }
        } as unknown as TestContext;

        recorder.flush(fakeContext);

        expect(reporter.report).toHaveBeenCalledWith({
            'failureMessages': ['expected failure'],
            'recordedContext': [
                {
                    'label': 'note',
                    'detail': { 'detail': 42 }
                }
            ]
        });
    });

    it('continues reporting when a diagnostic reporter fails', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        const reporterError = new Error('reporter unavailable');

        const failingReporter = { 'report': vi.fn(() => { throw reporterError; }) };

        const succeedingReporter = { 'report': vi.fn() };

        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.addReporter(failingReporter);

        recorder.addReporter(succeedingReporter);

        const context = {
            'task': {
                'result': { 'errors': [{ 'message': 'expected failure' }] }
            }
        } as unknown as TestContext;

        expect(() => { recorder.flush(context); }).not.toThrow();

        expect(succeedingReporter.report).toHaveBeenCalledOnce();

        expect(consoleSpy).toHaveBeenCalledWith(
            '\n[Integration Test Diagnostic Reporter Failure] unit-test',
            reporterError
        );
    });

    it('suppresses reporter failure details when the CI diagnostics policy is enabled', () => {
        vi.stubEnv('VITEST_INTEGRATION_HARNESS_ERROR_DETAILS', 'none');

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.addReporter({
            'report': (): void => { throw new Error('Bearer secret-token'); }
        });

        recorder.flush({
            'task': {
                'result': { 'errors': [{ 'message': 'expected failure' }] }
            }
        } as unknown as TestContext);

        expect(consoleSpy).toHaveBeenCalledWith(
            '\n[Integration Test Diagnostic Reporter Failure] unit-test',
            '[SUPPRESSED]'
        );
    });

    it('redacts nested built-in and suite-specific sensitive diagnostic values before emission', () => {
        /** Spy replacing `console.error` so the expected diagnostic output does not reach the test runner. */
        vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        /** Reporter spy that receives the redacted payload when the recorder flushes. */
        const reporter = { 'report': vi.fn() };

        /** Recorder under test, scoped to a fake test name since this exercises the class directly. */
        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.addRedactionRules(['privateValue', 'clientId', /session[-_]?id/iu]);

        recorder.record('response', {
            'authorization': 'Bearer real-token',
            'nested': {
                'apiKey': 'real-api-key',
                'privateValue': 'internal-value',
                'CLIENTID': 'real-client-id',
                'session_id': 'real-session-id',
                'safeValue': 'safe-value'
            }
        });

        /** Minimal fake test context, shaped just enough for `flush` to read a failure message from it. */
        const fakeContext = {
            'task': {
                'name': 'unit-test',
                'result': { 'errors': [{ 'message': 'expected failure' }] }
            }
        } as unknown as TestContext;

        recorder.addReporter(reporter);

        recorder.flush(fakeContext);

        expect(reporter.report).toHaveBeenCalledWith(expect.objectContaining({
            'recordedContext': [
                {
                    'label': 'response',
                    'detail': {
                        'authorization': '[REDACTED]',
                        'nested': {
                            'apiKey': '[REDACTED]',
                            'privateValue': '[REDACTED]',
                            'CLIENTID': '[REDACTED]',
                            'session_id': '[REDACTED]',
                            'safeValue': 'safe-value'
                        }
                    }
                }
            ]
        }));
    });

    it('does not redact property names that only contain built-in redaction names', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        let capturedPayload: FailureDiagnosticsPayload | undefined;

        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.addReporter({
            'report': (payload: FailureDiagnosticsPayload): void => {
                capturedPayload = payload;
            }
        });

        recorder.record('response', {
            'tokenizerVersion': 'v2',
            'secretaryName': 'Morgan',
            'monkey': 'tool',
            'authorization': 'Bearer real-token'
        });

        recorder.flush({ 'task': { 'result': { 'errors': [] } } } as unknown as TestContext);

        expect(capturedPayload?.recordedContext).toEqual([
            {
                'label': 'response',
                'detail': {
                    'tokenizerVersion': 'v2',
                    'secretaryName': 'Morgan',
                    'monkey': 'tool',
                    'authorization': '[REDACTED]'
                }
            }
        ]);
    });

    it('applies rules added after recording and does not invoke diagnostic accessors', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        const recorder = new DiagnosticsRecorder('unit-test');

        const detail = {} as {
            'serviceCredential': string;
            'sideEffect': string;
        };

        Object.defineProperty(detail, 'serviceCredential', {
            'enumerable': true,
            'value': 'secret'
        });

        Object.defineProperty(detail, 'sideEffect', {
            'enumerable': true,
            'get': () => { throw new Error('getter must not run'); }
        });

        recorder.record('response', detail);

        recorder.addRedactionRules(['serviceCredential']);

        recorder.flush({ 'task': { 'result': { 'errors': [] } } } as unknown as TestContext);

        const [renderedDiagnostics] = consoleSpy.mock.calls[0] as [string];

        expect(renderedDiagnostics).toContain('label: \'response\'');

        expect(renderedDiagnostics).toContain('serviceCredential: \'[REDACTED]\'');

        expect(renderedDiagnostics).toContain('sideEffect: \'[Accessor diagnostic value]\'');
    });

    it('represents Error, non-plain, array, and circular diagnostic values safely', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        let capturedPayload: FailureDiagnosticsPayload | undefined;

        const reporter = {
            'report': (payload: FailureDiagnosticsPayload): void => {
                capturedPayload = payload;
            }
        };

        const recorder = new DiagnosticsRecorder('unit-test');

        const detail: {
            'error': Error;
            'date': Date;
            'values': unknown[];
            'self'?: unknown;
        } = {
            'error': new Error('request failed'),
            'date': new Date(),
            'values': ['value']
        };

        detail.self = detail;

        recorder.record('response', detail);

        recorder.addReporter(reporter);

        recorder.flush({ 'task': { 'result': { 'errors': [] } } } as unknown as TestContext);

        expect(capturedPayload).toBeDefined();

        const recordedEntry = capturedPayload!.recordedContext[0]!;

        expect(recordedEntry.label).toBe('response');

        const sanitizedDetail = recordedEntry.detail as {
            'error': {
                'name': string;
                'message': string;
                'stack': string | undefined;
            };
            'date': string;
            'values': unknown[];
            'self': unknown;
        };

        expect(sanitizedDetail.error.name).toBe('Error');

        expect(sanitizedDetail.error.message).toBe('request failed');

        expect(sanitizedDetail.date).toBe('[Non-plain diagnostic value]');

        expect(sanitizedDetail.values).toEqual(['value']);

        expect(sanitizedDetail.self).toBe(sanitizedDetail);
    });
});

void describe('integration lifecycle wiring (real fixtures)', () => {
    /** Records the order the real `resources` fixture actually ran cleanup callbacks in, across tests below. */
    const cleanupOrder: string[] = [];

    integrationTest('tracks resources through the real fixture and defers cleanup until after the test', async ({ resources }) => {
        await resources.track('outer', (): Promise<object> => Promise.resolve({}), () => { cleanupOrder.push('outer'); });

        await resources.track('inner', (): Promise<object> => Promise.resolve({}), () => { cleanupOrder.push('inner'); });

        // Cleanup is only registered here - it must not have run yet.
        expect(cleanupOrder).toEqual([]);
    });

    integrationTest('previous test\'s resources were already cleaned up in LIFO order by the time this test runs', ({ resources }) => {
        resources.markNoResources();

        expect(cleanupOrder).toEqual(['inner', 'outer']);
    });
});

void describe('Failure Snapshot', () => {
    /**
     * Returns a fixture process's exit status or throws if it did not start or complete normally.
     * @param fixturePath Path to the fixture that was run.
     * @param result Result returned by `spawnSync`.
     * @returns The fixture process's exit status.
     */
    function getFixtureExitStatus(fixturePath: string, result: SpawnSyncReturns<string>): number {
        if (result.error !== void 0) {
            throw new Error(`Could not start failure snapshot fixture ${ fixturePath }: ${ result.error.message }`);
        }

        if (result.signal !== null) {
            throw new Error(`Failure snapshot fixture ${ fixturePath } was terminated by signal ${ result.signal }.`);
        }

        if (result.status === null) {
            throw new Error(`Failure snapshot fixture ${ fixturePath } did not return an exit status.`);
        }

        return result.status;
    }

    /**
     * Runs a fixture in a child process and captures its output, so assertions can be made on the text without
     * the fixture's own test failures affecting the parent process.
     * @param fixturePath Path to the fixture to run, relative to the project root.
     * @returns The child process exit status and combined stdout/stderr output with ANSI escape codes stripped out.
     */
    function runFixtureAndCaptureOutput(fixturePath: string): {
        /** The exit status of the child process running the fixture. */
        'status': number,
        /** The combined stdout/stderr output of the child process, with ANSI escape codes stripped out. */
        'output': string;
    } {
        /** The process result from the child fixture run. */
        const result = spawnSync(
            process.execPath,
            [
                './node_modules/vitest/vitest.mjs',
                'run',
                '--config',
                'vitest.failure-fixtures.config.ts',
                fixturePath
            ],
            {
                'cwd': process.cwd(),
                'encoding': 'utf8'
            }
        );

        /** The combined process output and process error output. */
        const output = `${ result.stdout }\n${ result.stderr }`;

        /**
         * The process output with ANSI escape codes stripped out,
         * so assertions can be made on the text.
         */
        // eslint-disable-next-line no-control-regex
        const cleanOutput = output.replaceAll(/\x1B\[[0-?]*[ -/]*[@-~]/gu, '');

        return {
            'status': getFixtureExitStatus(fixturePath, result),
            'output': cleanOutput
        };
    }

    it('throws a descriptive error when the child process cannot start', () => {
        /** Error reported by the operating system when it cannot start the child process. */
        const startupError = new Error('spawn failed');

        const result = {
            'error': startupError,
            'output': [null, '', ''],
            'pid': 0,
            'signal': null,
            'status': null,
            'stderr': '',
            'stdout': ''
        } as SpawnSyncReturns<string>;

        expect(() => { getFixtureExitStatus('test/fixtures/failure-diagnostics.fixture.ts', result); }).toThrow('Could not start failure snapshot fixture test/fixtures/failure-diagnostics.fixture.ts: spawn failed');
    });

    it('throws when the child process is terminated by a signal', () => {
        const result = {
            'output': [null, '', ''],
            'pid': 1,
            'signal': 'SIGTERM',
            'status': null,
            'stderr': '',
            'stdout': ''
        } as SpawnSyncReturns<string>;

        expect(() => { getFixtureExitStatus('test/fixtures/failure-diagnostics.fixture.ts', result); }).toThrow('Failure snapshot fixture test/fixtures/failure-diagnostics.fixture.ts was terminated by signal SIGTERM.');
    });

    it('throws when the child process does not return an exit status', () => {
        const result = {
            'output': [null, '', ''],
            'pid': 1,
            'signal': null,
            'status': null,
            'stderr': '',
            'stdout': ''
        } as SpawnSyncReturns<string>;

        expect(() => { getFixtureExitStatus('test/fixtures/failure-diagnostics.fixture.ts', result); }).toThrow('Failure snapshot fixture test/fixtures/failure-diagnostics.fixture.ts did not return an exit status.');
    });

    it('captures and emits a failure snapshot when a test fails', () => {
        /** The path to the failure-diagnostics fixture. */
        const fixturePath = 'test/fixtures/failure-diagnostics.fixture.ts';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).not.toBe(0);

        expect(output).toContain('[Integration Test Failure Diagnostics]');

        expect(output).toContain('expected failure');

        expect(output).toContain('diagnostic');
    });

    it('captures and emits a cleanup failure snapshot when a cleanup fails', () => {
        /** The path to the cleanup-diagnostics fixture. */
        const fixturePath = 'test/fixtures/cleanup-diagnostics.fixture.ts';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).not.toBe(0);

        expect(output).toContain('ResourceCleanupError: [emits cleanup failure diagnostics] 1 resource cleanup action failed:');

        expect(output).toContain('my cloud resource');

        expect(output).toContain('cleanup exception');
    });

    it('skips test execution when the file-scoped environment is unready', () => {
        /** The path to the fixture whose test body must be skipped. */
        const fixturePath = 'test/fixtures/unready-environment.fixture.ts';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).toBe(0);

        expect(output).toContain('1 skipped');

        expect(output).not.toContain('unready environment allowed the test body to run');

        expect(output).not.toContain('unready suite setup ran');
    });

    it('runs file-scoped readiness once for every test in a fixture file', () => {
        /** The path to the fixture that checks a shared file-scoped readiness counter. */
        const fixturePath = 'test/fixtures/file-scoped-readiness.fixture.ts';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).toBe(0);

        expect(output).toContain('2 passed');
    });

    it('runs paired suite cleanup after all tests in LIFO order', () => {
        const fixturePath = 'test/fixtures/suite-lifecycle.fixture.ts';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).not.toBe(0);

        const setupIndex = output.indexOf('[suite lifecycle] setup');

        const testIndex = output.indexOf('[suite lifecycle] test');

        const pairedCleanupIndex = output.indexOf('[suite lifecycle] paired cleanup');

        const additionalCleanupIndex = output.indexOf('[suite lifecycle] additional cleanup');

        expect(setupIndex).toBeGreaterThanOrEqual(0);

        expect(testIndex).toBeGreaterThan(setupIndex);

        expect(pairedCleanupIndex).toBeGreaterThan(testIndex);

        expect(additionalCleanupIndex).toBeGreaterThan(pairedCleanupIndex);
    });

    it('preserves suite setup and cleanup failures together', () => {
        const fixturePath = 'test/fixtures/suite-setup-and-cleanup-failure.fixture.ts';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).not.toBe(0);

        expect(output).toContain('suite setup failed');

        expect(output).toContain('suite cleanup failed');
    });

    it('emits diagnostics when a test and its cleanup both fail', () => {
        /** The path to the fixture that combines test and cleanup failures. */
        const fixturePath = 'test/fixtures/test-and-cleanup-failure.fixture.ts';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).not.toBe(0);

        expect(output).toContain('[Integration Test Failure Diagnostics]');

        expect(output).toContain('expected test failure');

        expect(output).toContain('fixture resource');

        expect(output).toContain('expected cleanup failure');
    });

    it('reports a plain suite setup failure when cleanup does not also fail', () => {
        const fixturePath = 'test/fixtures/suite-setup-only-failure.fixture.ts';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).not.toBe(0);

        expect(output).toContain('suite setup only failure');

        expect(output).not.toContain('test body should not run');
    });

    it('fails the suite when setup does not declare resources or markNoResources()', () => {
        const fixturePath = 'test/fixtures/suite-missing-declaration.fixture.ts';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).not.toBe(0);

        expect(output).toContain('must call');

        expect(output).not.toContain('test body should not run');
    });
});
