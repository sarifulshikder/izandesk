import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // This app was written as loosely-typed JS-in-TS. Enforcing the strict
    // Next.js defaults here would fail on thousands of pre-existing `any`s
    // and effect patterns and hide real regressions. Keep the rules that
    // catch actual breakage; report the rest as warnings.
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@next/next/no-assign-module-variable': 'off',
      '@next/next/no-html-link-for-pages': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  globalIgnores([
    '.next/**',
    '.next-*/**',
    'out/**',
    'build/**',
    'tmp/**',
    'next-env.d.ts',
  ]),
])

export default eslintConfig
