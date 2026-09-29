import type { ReactNode } from 'react';

const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Renders `[text](https://url)` as links and leaves everything else as text. */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const [full, label, url] = match;
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    nodes.push(
      <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>,
    );
    lastIndex = index + full.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Splits markdown into paragraphs; HTML is never interpreted. */
export function splitParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
