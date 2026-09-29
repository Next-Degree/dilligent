import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The design system ships .tsx sources; force the automatic JSX runtime so
  // they compile without a global React.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
