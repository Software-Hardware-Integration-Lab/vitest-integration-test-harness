import { type TestContext, afterEach, describe, expect, it, vi } from 'vitest';
import DiagnosticsRecorder, { type FailureDiagnosticsPayload } from '../src/harness/diagnostics.js';
import { evaluateReadiness } from '../src/harness/environment.js';
import ResourceCleanupError from '../src/harness/resourceCleanupError.js';
import ResourceTracker from '../src/harness/resourceTracker.js';
import { integrationTest } from '../src/harness/integrationTestLifecycle.js';
import { spawnSync } from 'node:child_process';

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

    it('exposes descriptions of resources still tracked', () => {
        /** Tracker under test, scoped to a fake test name since this exercises the class directly. */
        const tracker = new ResourceTracker('unit-test');

        tracker.track('alpha', () => { /* No-op cleanup */ });

        tracker.track('beta', () => { /* No-op cleanup */ });

        expect(tracker.getTrackedDescriptions()).toEqual(['alpha', 'beta']);
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

    integrationTest('diagnostics fixture is present without a test explicitly requesting it', ({ diagnostics }) => {
        expect(diagnostics).toBeInstanceOf(DiagnosticsRecorder);
    });
});

void describe('Failure Snapshot', () => {
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
        /** The script to run to allow the fixture to run as a child test. */
        const runnerScript = `
    import { startVitest } from 'vitest/node';

    const vitest = await startVitest('test', [], {
        include: [${ JSON.stringify(fixturePath) }],
        environment: 'node',
        pool: 'forks',
        fileParallelism: false
    });

    process.exitCode = vitest?.state.getFiles().some((file) =>
        file.result?.state === 'fail'
    ) ? 1 : 0;
`;

        /** The process result from the child fixture run. */
        const result = spawnSync(
            process.execPath,
            ['--input-type=module', '--eval', runnerScript],
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
            'status': result.status ?? 0,
            'output': cleanOutput
        };
    }

    it('captures and emits a failure snapshot when a test fails', () => {
        /** The path to the failure-diagnostics fixture. */
        const fixturePath = 'bin/test/fixtures/failure-diagnostics.fixture.js';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).not.toBe(0);

        expect(output).toContain('[Integration Test Failure Diagnostics]');

        expect(output).toContain('expected failure');

        expect(output).toContain('diagnostic');
    });

    it('captures and emits a cleanup failure snapshot when a cleanup fails', () => {
        /** The path to the cleanup-diagnostics fixture. */
        const fixturePath = 'bin/test/fixtures/cleanup-diagnostics.fixture.js';

        const { status, output } = runFixtureAndCaptureOutput(fixturePath);

        expect(status).not.toBe(0);

        // Contains stack trace
        expect(output).toContain('at Object.cleanup');

        // Contains resource name
        expect(output).toContain('my cloud resource');

        // Contains cleanup error message
        expect(output).toContain('cleanup exception');
    });
});
