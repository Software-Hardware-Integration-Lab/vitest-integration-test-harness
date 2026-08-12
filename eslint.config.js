import { eslintConfig } from '@software-hardware-integration-lab/development-utilities/optimized/lint/base.js'
import { defineConfig } from 'eslint/config'

export default defineConfig([
    ...eslintConfig,
    {
        rules: {
            'no-continue': 'off',
            'sort-imports': 'off',
            'sort-keys': 'off',
            'jsdoc/require-jsdoc': [
                'warn',
                {
                    'publicOnly': { 'esm': true },
                    'contexts': [
                        'ExportNamedDeclaration > ClassDeclaration',
                        'ExportNamedDeclaration > FunctionDeclaration',
                        'ExportNamedDeclaration > TSInterfaceDeclaration',
                        'ExportNamedDeclaration > TSTypeAliasDeclaration',
                        'ExportDefaultDeclaration > ClassDeclaration',
                        'ExportDefaultDeclaration > FunctionDeclaration'
                    ],
                    'require': {
                        'ArrowFunctionExpression': false,
                        'ClassDeclaration': true,
                        'FunctionDeclaration': true,
                        'FunctionExpression': false,
                        'MethodDefinition': false
                    }
                }
            ],
        }
    }
])
