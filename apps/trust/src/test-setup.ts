import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no PointerEvent, which base-ui components construct on click.
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  Object.defineProperty(window, 'PointerEvent', {
    value: class PointerEvent extends MouseEvent {},
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
});
