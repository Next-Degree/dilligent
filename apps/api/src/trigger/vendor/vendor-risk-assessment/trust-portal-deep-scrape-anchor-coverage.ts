import type { DeepScrapeSection } from './trust-portal-deep-scrape-sections';

/**
 * A genuine SPA trust portal renders a lean shell up front (nav + minimal hero
 * copy) and injects each tab's real content only once revealed by JS, so its
 * initial scrape's markdown is short. An ordinary page that merely uses
 * in-page anchor nav (e.g. a marketing "Security" page with a jump-to-section
 * table of contents) renders all of its content up front, so its initial
 * markdown is already long. Past this length we treat same-page `#anchor`
 * sections as already covered by the initial scrape, instead of paying for a
 * full click-and-rescrape of content already in hand — this is what turned a
 * single ordinary page into 8+ extra scrapes in production.
 */
export const SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH = 4000;

/**
 * Drops same-page `#anchor` sections once the initial scrape's markdown looks
 * substantial enough to already contain everything those anchors point to.
 * Path-based sections (a distinct URL) and synthesized SPA tab clicks
 * (`anchor: null`) are always kept — the initial scrape can't have captured
 * either one.
 */
export function filterUncoveredAnchorSections(params: {
  sections: DeepScrapeSection[];
  initialMarkdown: string;
}): DeepScrapeSection[] {
  const { sections, initialMarkdown } = params;
  if (initialMarkdown.length < SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH) {
    return sections;
  }
  return sections.filter((section) => !section.anchor);
}
