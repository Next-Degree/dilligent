import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default [
  {
    ignores: [
      '**/.next/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/.turbo/**',
      '**/out/**',
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // This repo has existing violations; keep lint actionable while we migrate.
      '@typescript-eslint/no-explicit-any': 'off',
      'react/no-unescaped-entities': 'off',
      'prefer-const': 'off',
      // eslint-config-next 16 enables the React Compiler-based react-hooks rules.
      // The existing code base has many violations; disable them until they are
      // migrated so lint keeps the same strictness as before the upgrade.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/static-components': 'off',
    },
  },
];
