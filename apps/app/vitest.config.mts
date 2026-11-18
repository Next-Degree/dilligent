import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.json'] }), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-utils/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'prisma/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    exclude: ['node_modules', 'dist', '.next', 'e2e'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/app/(app)/*/security/penetration-tests/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/test-utils/',
        '.trigger/**',
        '.next/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/*',
        '**/*.test.{ts,tsx}',
      ],
    },
  },
  resolve: {
    // Exact-match regexes so subpath imports (e.g. @trycompai/auth/participation)
    // still resolve through the package exports instead of being rewritten.
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      {
        find: /^@trycompai\/auth$/,
        replacement: resolve(__dirname, '../../packages/auth/src/index.ts'),
      },
      {
        find: /^@trycompai\/billing$/,
        replacement: resolve(__dirname, '../../packages/billing/src/index.ts'),
      },
    ],
  },
});
