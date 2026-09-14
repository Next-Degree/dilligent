// Pure helper: convert a Firecrawl scrape's `links` array into an ordered,
// deduped list of section URLs for the trust-portal deep-scrape pass.
//
// A "section URL" is either:
//   - an intra-page anchor on the same path as the source URL (e.g. `/trust-center#cloud-security`)
//   - a same-origin URL whose path is nested under the source path (e.g. `/trust-center/cloud-security`)
//
// Cross-origin links, the source URL itself, and duplicates are dropped.

export const MAX_SECTION_URLS = 25;

/**
 * A genuine SPA trust portal renders a lean shell up front (nav + minimal hero
 * copy) and injects each tab's real content only once revealed by JS, so its
 * initial scrape's markdown is short. An ordinary page that merely uses in-page
 * anchor nav (e.g. a marketing "Security" page with a jump-to-section table of
 * contents) renders all of its content up front, so its initial markdown is
 * already long. Past this length, intra-page anchors are treated as already
 * covered by the initial scrape rather than as hidden panels worth a full
 * click-and-rescrape — this is what turned one ordinary page into 8+ extra
 * scrapes in production.
 */
export const SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH = 4000;

export type DeepScrapeSection = {
  url: string;
  /** The anchor fragment including the `#` (e.g. `#cloud-security`), or null for path-based sections. */
  anchor: string | null;
  /** A human-friendly label used for logging and markdown section headers. */
  label: string;
  /**
   * When present, the section must be revealed by clicking a DOM element whose
   * textContent equals this value. Used for SPA trust portals where sidebar
   * items are buttons/divs without href attributes (e.g. Ubiquiti).
   */
  tabLabel?: string | null;
};

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function deriveLabel(sectionUrl: URL, anchor: string | null): string {
  if (anchor) {
    return anchor.slice(1); // drop leading `#`
  }
  const segments = stripTrailingSlash(sectionUrl.pathname).split('/');
  return segments[segments.length - 1] || sectionUrl.pathname;
}

export function discoverSectionUrls(params: {
  sourceUrl: string;
  links: string[];
  /**
   * Markdown from the initial scrape of `sourceUrl`. Once it looks substantial
   * the page has already rendered everything its anchors point at, so anchors
   * are not emitted as sections at all — keeping them out of the
   * `MAX_SECTION_URLS` budget, and leaving an empty result honest so the caller
   * can fall back to SPA tab detection.
   */
  initialMarkdown?: string;
}): DeepScrapeSection[] {
  const { sourceUrl, links, initialMarkdown = '' } = params;
  if (!links || links.length === 0) return [];

  const anchorsAlreadyCovered =
    initialMarkdown.length >= SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH;

  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch {
    return [];
  }

  const sourceOrigin = source.origin;
  const sourcePath = stripTrailingSlash(source.pathname);
  const sourceCanonical = `${sourceOrigin}${sourcePath}`;

  const seen = new Set<string>();
  const sections: DeepScrapeSection[] = [];

  for (const raw of links) {
    if (sections.length >= MAX_SECTION_URLS) break;
    if (!raw || typeof raw !== 'string') continue;

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }

    if (parsed.origin !== sourceOrigin) continue;

    const parsedPath = stripTrailingSlash(parsed.pathname);
    const hasFragment = parsed.hash && parsed.hash.length > 1;

    const isIntraPageAnchor = parsedPath === sourcePath && hasFragment;
    const isSamePathChild =
      !hasFragment &&
      parsedPath !== sourcePath &&
      (parsedPath.startsWith(`${sourcePath}/`) ||
        (sourcePath === '' && parsedPath.startsWith('/')));

    if (!isIntraPageAnchor && !isSamePathChild) continue;
    if (isIntraPageAnchor && anchorsAlreadyCovered) continue;

    const anchor = isIntraPageAnchor ? parsed.hash : null;
    const canonical = anchor
      ? `${sourceCanonical}${anchor}`
      : `${sourceOrigin}${parsedPath}`;

    if (canonical === sourceCanonical) continue;
    if (seen.has(canonical)) continue;
    seen.add(canonical);

    sections.push({
      url: canonical,
      anchor,
      label: deriveLabel(new URL(canonical), anchor),
    });
  }

  return sections;
}
