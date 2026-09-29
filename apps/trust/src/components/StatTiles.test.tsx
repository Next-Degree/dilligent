import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatTiles } from './StatTiles';

describe('StatTiles', () => {
  it('renders all four counts', () => {
    render(<StatTiles stats={{ policies: 14, frameworks: 5, controls: 44, subprocessors: 6 }} />);
    for (const [label, value] of [
      ['Policies', '14'],
      ['Frameworks', '5'],
      ['Controls', '44'],
      ['Subprocessors', '6'],
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(value)).toBeTruthy();
    }
  });

  it('is 2 columns on mobile and 4 from tablet up', () => {
    const { container } = render(
      <StatTiles stats={{ policies: 1, frameworks: 1, controls: 1, subprocessors: 1 }} />,
    );
    const grid = container.firstElementChild;
    expect(grid?.className).toContain('grid-cols-2');
    expect(grid?.className).toContain('md:grid-cols-4');
  });
});
