import { defineConfig } from 'vitest/config';

export default defineConfig({
    'test': {
        'name': 'failure-fixtures',
        'include': ['test/fixtures/**/*.fixture.ts'],
        'environment': 'node',
        'pool': 'forks',
        'fileParallelism': false
    }
});
