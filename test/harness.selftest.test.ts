import { type TestContext, afterEach, describe, expect, it, vi } from 'vitest';
import DiagnosticsRecorder from '../src/harness/base/private/classes/diagnostics.js';
import type FailureDiagnosticsPayload from '../src/harness/base/public/interfaces/failureDiagnosticsPayload.js';
import { evaluateReadiness } from '../src/harness/base/public/modules/environment.js';
import ResourceCleanupError from '../src/harness/base/public/errors/resourceCleanupError.js';
import ResourceTracker from '../src/harness/base/public/classes/resourceTracker.js';
import { integrationTest } from '../src/harness/base/public/modules/integrationTestLifecycle.js';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

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

    it('redacts nested built-in and suite-specific sensitive diagnostic values before emission', () => {
        /** Spy replacing `console.error` so the expected diagnostic output does not reach the test runner. */
        vi.spyOn(console, 'error').mockImplementation(() => { /* Silence expected diagnostic output */ });

        /** Reporter spy that receives the redacted payload when the recorder flushes. */
        const reporter = { 'report': vi.fn() };

        /** Recorder under test, scoped to a fake test name since this exercises the class directly. */
        const recorder = new DiagnosticsRecorder('unit-test');

        recorder.addRedactionRules(['privateValue', /session[-_]?id/iu]);

        recorder.record('response', {
            'authorization': 'Bearer real-token',
            'nested': {
                'apiKey': 'real-api-key',
                'privateValue': 'internal-value',
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
                            'session_id': '[REDACTED]',
                            'safeValue': 'safe-value'
                        }
                    }
                }
            ]
        }));
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

        // Contains stack trace
        expect(output).toContain('at Object.cleanup');

        // Contains resource name
        expect(output).toContain('my cloud resource');

        // Contains cleanup error message
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
