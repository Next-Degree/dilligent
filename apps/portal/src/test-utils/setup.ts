// Global test setup for Vitest component tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest does not expose `afterEach` globally here, so Testing Library cannot
// register its own cleanup. Without it, one test's rendered output leaks into
// the next and queries find several matches.
afterEach(() => {
  cleanup();
});
