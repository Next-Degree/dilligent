import { commentContentToText } from './evidence-comment-text';

describe('commentContentToText', () => {
  it('returns plain text comments unchanged', () => {
    expect(commentContentToText('Uploaded the Q1 access review')).toBe(
      'Uploaded the Q1 access review',
    );
  });

  it('returns non-rich JSON values unchanged', () => {
    expect(commentContentToText('42')).toBe('42');
  });

  it('flattens Tiptap JSON with mentions, breaks and lists', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'mention', attrs: { id: 'usr_1', label: 'Jane' } },
            { type: 'hardBreak' },
            { type: 'text', text: 'see attached' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
              ],
            },
          ],
        },
      ],
    };

    expect(commentContentToText(JSON.stringify(doc))).toBe(
      'Hi @Jane\nsee attached\n- one',
    );
  });

  it('falls back to the mention id when there is no label', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'mention', attrs: { id: 'usr_9' } }],
    };
    expect(commentContentToText(JSON.stringify(doc))).toBe('@usr_9');
  });

  it('keeps link targets, without repeating a URL that is already the text', () => {
    const link = (text: string, href: string) => ({
      type: 'text',
      text,
      marks: [{ type: 'bold' }, { type: 'link', attrs: { href } }],
    });
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            link('Q1 review', 'https://drive.example.com/q1'),
            { type: 'text', text: ' and ' },
            link('https://x.example.com', 'https://x.example.com'),
          ],
        },
      ],
    };

    expect(commentContentToText(JSON.stringify(doc))).toBe(
      'Q1 review (https://drive.example.com/q1) and https://x.example.com',
    );
  });

  it('names images, without dumping inline base64 data', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://cdn.example.com/a.png' } },
        { type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } },
      ],
    };

    expect(commentContentToText(JSON.stringify(doc))).toBe(
      '[image: https://cdn.example.com/a.png][image]',
    );
  });
});
