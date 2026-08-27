// #region Environment

export { evaluateReadiness } from './harness/base/public/environment/evaluateReadiness.js';

export { evaluateEnvironmentVariables } from './harness/base/public/environment/evaluateEnvironmentVariables.js';

export type {
    EnvironmentReadiness,
    EnvironmentVariableCheckResult,
    ReadinessCheck,
    TestableEnvironmentVariable
} from './harness/base/public/environment/environmentTypes.js';

// #endregion Environment

// #region Retry

export { pollUntil, retry } from './utilities/public/retry/retry.js';

export { RetryTimeoutError } from './utilities/public/retry/errors/retryTimeoutError.js';

export { PollPredicateMismatchError } from './utilities/public/retry/errors/pollPredicateMismatchError.js';

export { MaxRetryAttemptsReachedError } from './utilities/public/retry/errors/maxRetryAttemptsReachedError.js';

// #endregion Retry

// #region Integration

export { integrationTest } from './harness/base/public/integration/integrationTestLifecycle.js';

export { createSuiteRunner } from './harness/base/public/integration/integrationSuite.js';

export { integrationSuite } from './harness/base/public/integration/integrationSuite.js';

export type {
    DiagnosticEntry,
    DiagnosticRedactionRule,
    DiagnosticReporter,
    Diagnostics,
    FailureDiagnosticsPayload,
    IntegrationSuiteContext,
    IntegrationSuiteOptions,
    IntegrationTestFixtures
} from './harness/base/public/integration/integrationTypes.js';

export { createEnvironmentProfile } from './harness/base/public/profile/createEnvironmentProfile.js';

// #endregion Integration

// #region Resource
export { default as ResourceCleanupError } from './harness/base/public/resource/errors/resourceCleanupError.js';

export { default as ResourceSetupError } from './harness/base/public/resource/errors/resourceSetupError.js';

export { default as ResourceTracker } from './harness/base/public/resource/resourceTracker.js';

export type { ResourceFailure as ResourceCleanupFailure } from './harness/base/public/resource/resourceTypes.js';
// #endregion Resource

// #region Profile
export type {
    DependencyType,
    EnvironmentProfile,
    EnvironmentProfileResult,
    ProfileFixtures,
    RiskLevel
} from './harness/base/public/profile/profileTypes.js';
// #endregion Profile

// #region Utilities

export type { PollResult, RetryOptions } from './utilities/public/retry/retryTypes.js';

// #endregion Utilities
