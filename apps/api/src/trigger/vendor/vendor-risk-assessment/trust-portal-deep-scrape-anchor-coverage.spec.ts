import {
  filterUncoveredAnchorSections,
  SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH,
} from './trust-portal-deep-scrape-anchor-coverage';
import type { DeepScrapeSection } from './trust-portal-deep-scrape-sections';

describe('filterUncoveredAnchorSections', () => {
  const anchorSection: DeepScrapeSection = {
    url: 'https://acme.com/security#overview',
    anchor: '#overview',
    label: 'overview',
  };
  const pathSection: DeepScrapeSection = {
    url: 'https://acme.com/trust-center/cloud-security',
    anchor: null,
    label: 'cloud-security',
  };
  const tabSection: DeepScrapeSection = {
    url: 'https://acme.com/trust-center',
    anchor: null,
    label: 'Philosophy',
    tabLabel: 'Philosophy',
  };

  it('keeps every section when the initial markdown is short (likely a real SPA shell)', () => {
    const result = filterUncoveredAnchorSections({
      sections: [anchorSection, pathSection, tabSection],
      initialMarkdown: '# Secure by Design\nTrust overview.',
    });

    expect(result).toEqual([anchorSection, pathSection, tabSection]);
  });

  it('drops same-page anchor sections once the initial markdown looks substantial', () => {
    const substantialMarkdown = 'x'.repeat(SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH);

    const result = filterUncoveredAnchorSections({
      sections: [anchorSection, pathSection, tabSection],
      initialMarkdown: substantialMarkdown,
    });

    expect(result).toEqual([pathSection, tabSection]);
  });

  it('keeps path-based sections and synthesized tab clicks even with substantial markdown', () => {
    const substantialMarkdown = 'x'.repeat(SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH);

    const result = filterUncoveredAnchorSections({
      sections: [pathSection, tabSection],
      initialMarkdown: substantialMarkdown,
    });

    expect(result).toEqual([pathSection, tabSection]);
  });

  it('treats the threshold as inclusive of longer markdown, not just equal length', () => {
    const result = filterUncoveredAnchorSections({
      sections: [anchorSection],
      initialMarkdown: 'x'.repeat(SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH + 5000),
    });

    expect(result).toEqual([]);
  });

  it('returns an empty array unchanged', () => {
    expect(
      filterUncoveredAnchorSections({ sections: [], initialMarkdown: '' }),
    ).toEqual([]);
  });
});
