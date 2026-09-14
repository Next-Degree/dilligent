import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

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
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      // This repo has existing violations; keep lint actionable while we migrate.
      '@typescript-eslint/no-explicit-any': 'off',
      'react/no-unescaped-entities': 'off',
      'prefer-const': 'off',

      // eslint-config-next 16 ships eslint-plugin-react-hooks v7, which turns on the
      // React Compiler rule set. Every one of those rules is back at its upstream
      // severity except set-state-in-effect: 161 pre-existing violations remain and
      // clearing them changes render timing, so they are handled separately.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];
