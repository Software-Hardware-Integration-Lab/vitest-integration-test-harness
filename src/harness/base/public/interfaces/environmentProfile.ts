import type { TestableEnvironmentVariable } from '../environment/environmentTypes.js';
import type { DependencyType } from './dependencyType.js';
import type { ProfileFixtures } from './profileFixtures.js';
import type ReadinessCheck from './readinessCheck.js';
import type { RiskLevel } from './riskLevel.js';

/**
 * Generic provider-agnostic integration environment profile configuration.
 */
export default interface EnvironmentProfile<TFixtures extends object = object> {
    /** Unique human-readable profile name. */
    'name': string;
    /** Neutral dependency category metadata. */
    'dependencyType': DependencyType;
    /** Neutral risk level metadata. */
    'riskLevel': RiskLevel;
    /** Ordered readiness checks to evaluate before allowing tests to run. */
    'readinessChecks': readonly ReadinessCheck[];
    /** Opt-in required environment variable names evaluated before readiness checks. */
    'requiredEnvironmentVariables'?: readonly TestableEnvironmentVariable[];
    /** Custom fixtures to extend the test context. Vitest may annotate these definitions during extension. */
    'fixtures'?: ProfileFixtures<TFixtures>;
    /** Consumer-defined classification tags. */
    'tags'?: readonly string[];
}
