import {
  discoverSectionUrls,
  SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH,
} from './trust-portal-deep-scrape-sections';

describe('discoverSectionUrls', () => {
  const sourceUrl = 'https://ui.com/us/en/trust-center';

  it('extracts intra-page anchors on the same path', () => {
    const links = [
      'https://ui.com/us/en/trust-center#philosophy',
      'https://ui.com/us/en/trust-center#cloud-security',
      'https://ui.com/us/en/trust-center#corporate-security',
      'https://ui.com/us/en/trust-center#ndaa-compliance',
    ];

    const result = discoverSectionUrls({ sourceUrl, links });

    expect(result.map((r) => r.url)).toEqual(
      expect.arrayContaining([
        'https://ui.com/us/en/trust-center#philosophy',
        'https://ui.com/us/en/trust-center#cloud-security',
        'https://ui.com/us/en/trust-center#corporate-security',
        'https://ui.com/us/en/trust-center#ndaa-compliance',
      ]),
    );
    expect(result).toHaveLength(4);
  });

  it('extracts same-path child URLs', () => {
    const links = [
      'https://acme.com/trust-center/cloud-security',
      'https://acme.com/trust-center/data-centers',
    ];

    const result = discoverSectionUrls({
      sourceUrl: 'https://acme.com/trust-center',
      links,
    });

    expect(result.map((r) => r.url).sort()).toEqual([
      'https://acme.com/trust-center/cloud-security',
      'https://acme.com/trust-center/data-centers',
    ]);
  });

  it('rejects external-domain links', () => {
    const links = [
      'https://ui.com/us/en/trust-center#cloud-security',
      'https://example.com/trust',
      'https://malicious.site/trust-center#fake',
    ];

    const result = discoverSectionUrls({ sourceUrl, links });

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(
      'https://ui.com/us/en/trust-center#cloud-security',
    );
  });

  it('rejects the source URL itself', () => {
    const links = [
      'https://ui.com/us/en/trust-center',
      'https://ui.com/us/en/trust-center#cloud-security',
    ];

    const result = discoverSectionUrls({ sourceUrl, links });

    expect(result.map((r) => r.url)).toEqual([
      'https://ui.com/us/en/trust-center#cloud-security',
    ]);
  });

  it('dedupes identical URLs', () => {
    const links = [
      'https://ui.com/us/en/trust-center#cloud-security',
      'https://ui.com/us/en/trust-center#cloud-security',
    ];

    const result = discoverSectionUrls({ sourceUrl, links });

    expect(result).toHaveLength(1);
  });

  it('caps at 25 sections (safety fuse)', () => {
    const links = Array.from(
      { length: 40 },
      (_, i) => `https://ui.com/us/en/trust-center#section-${i}`,
    );

    const result = discoverSectionUrls({ sourceUrl, links });

    expect(result).toHaveLength(25);
  });

  it('handles source URLs with trailing slash', () => {
    const links = ['https://acme.com/trust-center/cloud-security'];

    const result = discoverSectionUrls({
      sourceUrl: 'https://acme.com/trust-center/',
      links,
    });

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://acme.com/trust-center/cloud-security');
  });

  it('skips unparseable links silently', () => {
    const links = [
      'not-a-url',
      '',
      'https://ui.com/us/en/trust-center#cloud-security',
    ];

    const result = discoverSectionUrls({ sourceUrl, links });

    expect(result).toHaveLength(1);
  });

  it('derives a section label from the anchor fragment', () => {
    const links = ['https://ui.com/us/en/trust-center#cloud-security'];

    const result = discoverSectionUrls({ sourceUrl, links });

    expect(result[0].label).toBe('cloud-security');
    expect(result[0].anchor).toBe('#cloud-security');
  });

  it('derives a section label from the trailing path segment', () => {
    const links = ['https://acme.com/trust-center/cloud-security'];

    const result = discoverSectionUrls({
      sourceUrl: 'https://acme.com/trust-center',
      links,
    });

    expect(result[0].label).toBe('cloud-security');
    expect(result[0].anchor).toBeNull();
  });

  it('returns an empty array when links is undefined or empty', () => {
    expect(discoverSectionUrls({ sourceUrl, links: [] })).toEqual([]);
    expect(
      discoverSectionUrls({
        sourceUrl,
        links: undefined as unknown as string[],
      }),
    ).toEqual([]);
  });

  describe('when the initial scrape already looks substantial', () => {
    const substantialMarkdown = 'x'.repeat(SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH);

    it('keeps intra-page anchors when the initial markdown is short (a real SPA shell)', () => {
      const links = ['https://ui.com/us/en/trust-center#cloud-security'];

      const result = discoverSectionUrls({
        sourceUrl,
        links,
        initialMarkdown: '# Secure by Design\nTrust overview.',
      });

      expect(result).toHaveLength(1);
      expect(result[0].anchor).toBe('#cloud-security');
    });

    it('drops intra-page anchors the initial scrape already covers', () => {
      const links = [
        'https://ui.com/us/en/trust-center#overview',
        'https://ui.com/us/en/trust-center#cloud-security',
      ];

      const result = discoverSectionUrls({
        sourceUrl,
        links,
        initialMarkdown: substantialMarkdown,
      });

      expect(result).toEqual([]);
    });

    it('still keeps same-path child URLs, which the initial scrape cannot have covered', () => {
      const links = [
        'https://acme.com/trust-center#overview',
        'https://acme.com/trust-center/cloud-security',
      ];

      const result = discoverSectionUrls({
        sourceUrl: 'https://acme.com/trust-center',
        links,
        initialMarkdown: substantialMarkdown,
      });

      expect(result.map((r) => r.url)).toEqual([
        'https://acme.com/trust-center/cloud-security',
      ]);
    });

    it('does not let covered anchors consume the section budget', () => {
      // 30 anchors ahead of the real sub-pages would previously fill all 25
      // slots and then be dropped downstream, starving the sub-pages entirely.
      const links = [
        ...Array.from(
          { length: 30 },
          (_, i) => `https://acme.com/trust-center#section-${i}`,
        ),
        'https://acme.com/trust-center/cloud-security',
        'https://acme.com/trust-center/data-centers',
      ];

      const result = discoverSectionUrls({
        sourceUrl: 'https://acme.com/trust-center',
        links,
        initialMarkdown: substantialMarkdown,
      });

      expect(result.map((r) => r.url)).toEqual([
        'https://acme.com/trust-center/cloud-security',
        'https://acme.com/trust-center/data-centers',
      ]);
    });
  });
});
