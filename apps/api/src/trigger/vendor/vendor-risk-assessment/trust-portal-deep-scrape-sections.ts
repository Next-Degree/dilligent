// Pure helper: convert a Firecrawl scrape's `links` array into an ordered,
// deduped list of section URLs for the trust-portal deep-scrape pass.
//
// A "section URL" is either:
//   - an intra-page anchor on the same path as the source URL (e.g. `/trust-center#cloud-security`)
//   - a same-origin URL whose path is nested under the source path (e.g. `/trust-center/cloud-security`)
//
// Cross-origin links, the source URL itself, and duplicates are dropped.
//
// Intra-page anchors are additionally dropped when the initial scrape's markdown
// is long enough that the page clearly rendered its content up front — see
// `isSubstantialInitialMarkdown`.

export const MAX_SECTION_URLS = 25;

/**
 * A genuine SPA trust portal renders a lean shell up front (nav + minimal hero
 * copy) and injects each tab's real content only once revealed by JS, so its
 * initial scrape's markdown is short. An ordinary page that merely uses in-page
 * anchor nav (e.g. a marketing "Security" page with a jump-to-section table of
 * contents) renders all of its content up front, so its initial markdown is
 * already long. Past this length, intra-page anchors are treated as probably
 * already captured rather than as hidden panels worth a full click-and-rescrape
 * — this is what turned one ordinary page into 8+ extra scrapes in production.
 *
 * The length is a proxy, not a measurement of what the anchors point at, so the
 * cutoff is a judgement call: high enough that a shell of nav labels and a hero
 * line stays under it, low enough that a page with real prose clears it. Tune it
 * by comparing the `markdownLength` on the "initial scrape returned" log line
 * across a portal that must keep its tabs scraped and one that must not.
 */
export const SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH = 4000;

/**
 * Whether the initial scrape looks like it already returned the page's real
 * content, in which case there is probably no hidden panel left to reveal —
 * neither behind an intra-page anchor nor behind an SPA tab. Both the anchor
 * filter here and the caller's tab-detection fallback key off this one predicate
 * so they cannot disagree about whether a page is a lean SPA shell.
 */
export function isSubstantialInitialMarkdown(initialMarkdown: string): boolean {
  return initialMarkdown.length >= SUBSTANTIAL_INITIAL_MARKDOWN_LENGTH;
}

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

type SourceLocation = { origin: string; path: string };

function parseSource(sourceUrl: string): SourceLocation | null {
  try {
    const source = new URL(sourceUrl);
    return { origin: source.origin, path: stripTrailingSlash(source.pathname) };
  } catch {
    return null;
  }
}

/** A same-origin link to the source page's own path carrying a `#fragment`. */
function isIntraPageAnchorLink(raw: string, source: SourceLocation): boolean {
  if (!raw || typeof raw !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.origin !== source.origin) return false;
  if (!parsed.hash || parsed.hash.length <= 1) return false;
  return stripTrailingSlash(parsed.pathname) === source.path;
}

/**
 * Whether the page links to its own sections with `#fragment` jump links.
 *
 * This is the positive evidence that a page navigates in-page, and it is what
 * separates the two reasons `discoverSectionUrls` can come back empty: anchors
 * found and deliberately dropped (an ordinary long page — nothing hidden), or
 * no usable links at all (a genuine SPA whose sidebar items are hrefless
 * buttons — content still hidden, tab detection is the only way in). Callers
 * must not suppress the SPA fallback on markdown length alone: a real portal
 * whose shell carries heavy nav/footer chrome can clear that bar, and would
 * then be left unscraped.
 */
export function hasIntraPageAnchors(params: {
  sourceUrl: string;
  links: string[];
}): boolean {
  const source = parseSource(params.sourceUrl);
  if (!source) return false;
  return (params.links ?? []).some((raw) => isIntraPageAnchorLink(raw, source));
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
   * the page has very likely rendered what its anchors point at, so anchors are
   * not emitted as sections at all, keeping them out of the
   * `MAX_SECTION_URLS` budget. Callers must gate their SPA tab-detection
   * fallback on `isSubstantialInitialMarkdown` too, or the empty result here
   * reads as "no sections found" and buys back the scrapes this just saved.
   */
  initialMarkdown?: string;
}): DeepScrapeSection[] {
  const { sourceUrl, links, initialMarkdown = '' } = params;
  if (!links || links.length === 0) return [];

  const anchorsLikelyCovered = isSubstantialInitialMarkdown(initialMarkdown);

  const source = parseSource(sourceUrl);
  if (!source) return [];

  const { origin: sourceOrigin, path: sourcePath } = source;
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

    const isIntraPageAnchor = isIntraPageAnchorLink(raw, source);
    const isSamePathChild =
      !hasFragment &&
      parsedPath !== sourcePath &&
      (parsedPath.startsWith(`${sourcePath}/`) ||
        (sourcePath === '' && parsedPath.startsWith('/')));

    if (!isIntraPageAnchor && !isSamePathChild) continue;
    if (isIntraPageAnchor && anchorsLikelyCovered) continue;

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
