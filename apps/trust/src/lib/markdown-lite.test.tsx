import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderInline, splitParagraphs } from './markdown-lite';

describe('markdown-lite', () => {
  it('renders https links with safe rel attributes', () => {
    const { container } = render(
      <p>{renderInline('See [our policy](https://acme.com/p) today')}</p>,
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://acme.com/p');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toBe('See our policy today');
  });

  it('does not turn javascript: urls into links', () => {
    const { container } = render(<p>{renderInline('[x](javascript:alert(1))')}</p>);
    expect(container.querySelector('a')).toBeNull();
  });

  it('never interprets html', () => {
    const { container } = render(<p>{renderInline('<img src=x onerror=1>')}</p>);
    expect(container.querySelector('img')).toBeNull();
  });

  it('splits paragraphs on blank lines', () => {
    expect(splitParagraphs('a\n\n\nb\n\n  \nc')).toEqual(['a', 'b', 'c']);
  });
});
