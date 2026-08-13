import { type TestContext, afterEach, describe, expect, it, vi } from 'vitest';
import DiagnosticsRecorder from '../src/harness/base/private/classes/diagnostics.js';
import type FailureDiagnosticsPayload from '../src/harness/base/public/interfaces/failureDiagnosticsPayload.js';
import type EnvironmentReadiness from '../src/harness/base/public/interfaces/environmentReadiness.js';
import { evaluateReadiness } from '../src/harness/base/public/modules/environment.js';
import ResourceCleanupError from '../src/harness/base/public/errors/resourceCleanupError.js';
import ResourceTracker from '../src/harness/base/public/classes/resourceTracker.js';
import { integrationTest } from '../src/harness/base/public/modules/integrationTestLifecycle.js';
import { integrationSuite } from '../src/harness/base/public/modules/integrationSuite.js';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

const suiteLifecycleOrder: string[] = [];

const suiteTest = integrationSuite({
    'name': 'in-process suite lifecycle',
    'setup': ({ resources }): () => void => {
        suiteLifecycleOrder.push('setup');

        resources.track('additional suite state', () => { suiteLifecycleOrder.push('additional cleanup'); });

        return () => { suiteLifecycleOrder.push('paired cleanup'); };
    }
});

suiteTest('runs suite setup before the test body', () => {
    expect(suiteLifecycleOrder).toEqual(['setup']);
});

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
    it('cleans up tracked resources in reverse (LIFO) order', async () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        /** Records the order cleanup callbacks actually ran in. */
        const order: string[] = [];

        tracker.track('first', () => { order.push('first'); });

        tracker.track('second', () => { order.push('second'); });

        await tracker.cleanupAll();

        expect(order).toEqual(['second', 'first']);
    });

    it('attempts every cleanup even when one fails, and aggregates the failures', async () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        /** Spy proving the second cleanup still runs despite the first one throwing. */
        const secondCleanup = vi.fn();

        tracker.track('will fail', () => { throw new Error('cleanup boom'); });

        tracker.track('will still run', secondCleanup);

        await expect(tracker.cleanupAll()).rejects.toThrow(ResourceCleanupError);

        expect(secondCleanup).toHaveBeenCalledOnce();
    });

    it('exposes descriptions of resources and exceptions with failed cleanups', async () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        tracker.track('will fail', () => { throw new Error('cleanup boom'); });

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

    it('exposes descriptions of resources still tracked', () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        tracker.track('alpha', () => { /* No-op cleanup */ });

        tracker.track('beta', () => { /* No-op cleanup */ });

        expect(tracker.getTrackedDescriptions()).toEqual(['alpha', 'beta']);
    });

    it('retains failed cleanups so a later cleanup can retry them', async () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        /** Counts cleanup attempts to simulate a transient eventual-consistency failure. */
        let attempts = 0;

        tracker.track('eventually consistent resource', () => {
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
});

void describe('DiagnosticsRecorder', () => {
    afterEach(() => { vi.restoreAllMocks(); });

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

        /** Second argument passed to the `console.error` call, containing the structured diagnostic payload. */
        const [, payload] = consoleSpy.mock.calls[0] as [string, FailureDiagnosticsPayload];

        expect(payload.failureMessages).toEqual(['expected failure']);
    });

    it('emits an empty failure message list when Vitest reports no errors', () => {
        vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        const reporter = { 'report': vi.fn() };

        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.addReporter(reporter);

        recorder.flush({ 'task': { } } as unknown as TestContext);

        expect(reporter.report).toHaveBeenCalledWith(expect.objectContaining({ 'failureMessages': [] }));
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

        expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            'recordedContext': [
                {
                    'label': 'response',
                    'detail': {
                        'serviceCredential': '[REDACTED]',
                        'sideEffect': '[Accessor diagnostic value]'
                    }
                }
            ]
        }));
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

    integrationTest('tracks resources through the real fixture and defers cleanup until after the test', ({ resources }) => {
        resources.track('outer', () => { cleanupOrder.push('outer'); });

        resources.track('inner', () => { cleanupOrder.push('inner'); });

        // Cleanup is only registered here - it must not have run yet.
        expect(cleanupOrder).toEqual([]);
    });

    integrationTest('previous test\'s resources were already cleaned up in LIFO order by the time this test runs', () => {
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
});
