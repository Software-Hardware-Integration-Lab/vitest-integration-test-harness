import { defineConfig } from 'vitest/config';

export default defineConfig({
    'test': {
        'name': 'integration-external',
        'include': ['test/**/*.test.ts'],
        'environment': 'node',
        'coverage': {
            'provider': 'v8',
            'reporter': ['text', 'html', 'lcov', 'json-summary'],
            'include': ['src/**/*.ts'],
            'exclude': [
                'src/**/*.d.ts',
                'bin/**/index.js'
            ]
        }
    }
});
