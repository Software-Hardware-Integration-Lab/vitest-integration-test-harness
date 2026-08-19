import type { EnvironmentReadiness, TestableEnvironmentVariable } from './environmentTypes.js';

/**
 * Validates required environment variables against process.env (or a provided dictionary) and aggregates all
 * missing or failing variables into a formatted list before executing any readiness checks.
 * @param requiredVariables Opt-in list of required environment variables to validate.
 * @param env Optional environment variable dictionary to check against; defaults to `process.env`.
 * @returns Aggregated readiness result describing whether all required environment variables are present and valid.
 */
export function evaluateEnvironmentVariables(
    requiredVariables?: readonly TestableEnvironmentVariable[],
    env: Record<string, string | undefined> = process.env
): EnvironmentReadiness {
    if (!requiredVariables || requiredVariables.length === 0) {
        return {
            'ready': true,
            'reason': void 0
        };
    }

    const failures = new Map<string, string>();

    for (const envVar of requiredVariables) {
        const value = env[envVar.key];

        if (value === void 0) {
            failures.set(envVar.key, 'Variable is not set');
        } else if (!value.trim()) {
            failures.set(envVar.key, 'Variable is empty');
        } else if (envVar.check) {
            try {
                const checkResult = envVar.check(value);

                if (!checkResult.success) {
                    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Fallback to default message when customReason is an empty string
                    failures.set(envVar.key, checkResult.reason?.trim() || 'Validation check failed');
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);

                failures.set(envVar.key, message);
            }
        }
    }

    if (failures.size > 0) {
        const failureList = Array.from(failures, ([key, reason]) => `${ key }: ${ reason }`)
            .join(', ');

        return {
            'ready': false,
            'reason': failureList
        };
    }

    return {
        'ready': true,
        'reason': void 0
    };
}
