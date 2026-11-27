/**
 * Converts stored comment content (plain text or serialized Tiptap JSON) into
 * readable plain text for comments.txt in the evidence export.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringAttr(attrs: unknown, key: string): string {
  if (!isRecord(attrs)) return '';
  const value = attrs[key];
  return typeof value === 'string' ? value : '';
}

function mentionLabel(attrs: unknown): string {
  return stringAttr(attrs, 'label') || stringAttr(attrs, 'id');
}

/** Keeps a link's target when the visible text is not already the URL. */
function renderText(node: Record<string, unknown>): string {
  const text = typeof node.text === 'string' ? node.text : '';
  const marks = Array.isArray(node.marks) ? node.marks : [];
  const link = marks.find((mark) => isRecord(mark) && mark.type === 'link');
  const href = stringAttr(isRecord(link) ? link.attrs : undefined, 'href');
  return href && href !== text ? `${text} (${href})` : text;
}

/** Inline (data:) images would dump base64 into the text, so only name them. */
function renderImage(attrs: unknown): string {
  const src = stringAttr(attrs, 'src');
  return src && !src.startsWith('data:') ? `[image: ${src}]` : '[image]';
}

const BLOCK_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
]);

function renderRichTextNode(node: unknown): string {
  if (Array.isArray(node)) return node.map(renderRichTextNode).join('');
  if (!isRecord(node)) return '';

  if (node.type === 'text') return renderText(node);
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return `@${mentionLabel(node.attrs)}`;
  if (node.type === 'image') return renderImage(node.attrs);

  const inner = renderRichTextNode(node.content);
  if (node.type === 'listItem') return `- ${inner.trim()}\n`;
  if (typeof node.type === 'string' && BLOCK_NODE_TYPES.has(node.type)) {
    return `${inner}\n`;
  }
  return inner;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Comments are stored either as plain text or as serialized Tiptap JSON.
 * Returns readable plain text for both; anything unrecognised is returned as-is.
 */
export function commentContentToText(content: string): string {
  const parsed = parseJson(content);
  const isRichText =
    (isRecord(parsed) &&
      (parsed.type === 'doc' || Array.isArray(parsed.content))) ||
    (Array.isArray(parsed) && parsed.every(isRecord));

  if (!isRichText) return content;

  return renderRichTextNode(parsed)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
