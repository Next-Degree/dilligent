import Firecrawl from '@mendable/firecrawl-js';
import { logger } from '@trigger.dev/sdk';
import type { VendorRiskAssessmentCertification } from './agent-types';
import { isKnownThirdPartyPortalHost } from './url-validation';
import { filterUncoveredAnchorSections } from './trust-portal-deep-scrape-anchor-coverage';
import {
  discoverSectionUrls,
  MAX_SECTION_URLS,
  type DeepScrapeSection,
} from './trust-portal-deep-scrape-sections';
import { identifySidebarTabs } from './trust-portal-deep-scrape-tabs';
import {
  buildInitialScrapeOptions,
  buildSectionScrapeOptions,
} from './trust-portal-deep-scrape-scrape-options';
import {
  extractCertificationsFromMarkdown,
  truncateMarkdown,
} from './trust-portal-deep-scrape-extraction';

const SECTION_CONCURRENCY = 5;

type ScrapeResponse = { markdown?: string; links?: string[] };

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          results[index] = {
            status: 'fulfilled',
            value: await worker(items[index]),
          };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}

export type DeepScrapeParams = {
  vendorName: string;
  vendorDomain: string;
  sourceUrl: string | null;
  firecrawlClient: Firecrawl;
};

export async function deepScrapeTrustPortal(
  params: DeepScrapeParams,
): Promise<VendorRiskAssessmentCertification[] | null> {
  const { vendorName, vendorDomain, sourceUrl, firecrawlClient } = params;

  if (!sourceUrl) return null;

  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch {
    return null;
  }

  const host = source.hostname.toLowerCase();
  if (isKnownThirdPartyPortalHost(host)) {
    logger.info(
      'Trust portal deep-scrape skipped: third-party portal host already handled by agent',
      { vendorName, host },
    );
    return null;
  }

  const onVendorDomain =
    host === vendorDomain || host.endsWith(`.${vendorDomain}`);
  if (!onVendorDomain) {
    logger.info(
      'Trust portal deep-scrape skipped: source URL is not on vendor domain',
      { vendorName, host, vendorDomain },
    );
    return null;
  }

  logger.info('Trust portal deep-scrape starting', {
    vendorName,
    sourceUrl,
  });
  // 1. Initial scrape
  let initial: ScrapeResponse;
  try {
    initial = (await firecrawlClient.scrape(
      sourceUrl,
      buildInitialScrapeOptions() as unknown as Record<string, unknown>,
    )) as ScrapeResponse;
  } catch (error) {
    logger.warn('Trust portal deep-scrape: initial scrape failed', {
      vendorName,
      sourceUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const initialMarkdown = initial.markdown ?? '';
  const links = Array.isArray(initial.links) ? initial.links : [];
  logger.info('Trust portal deep-scrape: initial scrape returned', {
    vendorName,
    sourceUrl,
    markdownLength: initialMarkdown.length,
    linkCount: links.length,
  });
  // 2. Discover sections
  const urlSections = discoverSectionUrls({ sourceUrl, links });

  // 2a. If URL-based discovery found nothing (SPA sidebar with no hrefs),
  // ask an LLM to identify tab labels from the initial markdown and
  // synthesize click-by-text sections.
  const tabSections: DeepScrapeSection[] =
    urlSections.length === 0 && initialMarkdown.trim().length > 0
      ? (await identifySidebarTabs({ vendorName, initialMarkdown })).map(
          (tabLabel) => ({
            url: sourceUrl,
            anchor: null,
            label: tabLabel,
            tabLabel,
          }),
        )
      : [];

  const seenLabels = new Set<string>();
  const discoveredSections: DeepScrapeSection[] = [];
  for (const s of [...urlSections, ...tabSections]) {
    const key = s.label.trim().toLowerCase();
    if (!key || seenLabels.has(key)) continue;
    seenLabels.add(key);
    discoveredSections.push(s);
    if (discoveredSections.length >= MAX_SECTION_URLS) break;
  }

  // Drop same-page #anchor sections once the initial scrape already looks
  // substantial — a real trust-portal SPA renders a lean shell up front and
  // hides panels behind JS, but an ordinary anchor-nav page (e.g. a marketing
  // "Security" page) renders everything up front, so re-scraping each anchor
  // just repeats content already captured.
  const sections = filterUncoveredAnchorSections({
    sections: discoveredSections,
    initialMarkdown,
  });

  logger.info('Trust portal deep-scrape: sections discovered', {
    vendorName,
    sectionCount: sections.length,
    urlSectionCount: urlSections.length,
    tabSectionCount: tabSections.length,
    skippedAlreadyCovered: discoveredSections.length - sections.length,
    sections: sections.map((s) => s.label),
  });
  // 3. Per-section scrapes (bounded concurrency)
  const sectionResults = await mapWithConcurrency(
    sections,
    SECTION_CONCURRENCY,
    async (section) => {
      const response = (await firecrawlClient.scrape(
        section.url,
        buildSectionScrapeOptions(section) as unknown as Record<
          string,
          unknown
        >,
      )) as ScrapeResponse;
      return { section, markdown: response.markdown ?? '' };
    },
  );

  const sectionChunks: string[] = [];
  for (const [index, result] of sectionResults.entries()) {
    if (result.status === 'fulfilled') {
      const { section, markdown } = result.value;
      if (markdown.trim().length > 0) {
        sectionChunks.push(
          `\n\n---\n# Section: ${section.label}\n\n${markdown}`,
        );
      }
    } else {
      logger.warn('Trust portal deep-scrape: section scrape failed', {
        vendorName,
        section: sections[index].label,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }

  const combinedMarkdown = truncateMarkdown(
    [initialMarkdown, ...sectionChunks].join(''),
  );

  if (combinedMarkdown.trim().length === 0) {
    logger.warn(
      'Trust portal deep-scrape: combined markdown is empty, skipping extraction',
      { vendorName, sourceUrl },
    );
    return null;
  }
  // 4. AI extraction
  const extracted = await extractCertificationsFromMarkdown({
    vendorName,
    combinedMarkdown,
  });
  if (!extracted) return null;

  const certifications: VendorRiskAssessmentCertification[] =
    extracted.certifications
      .filter((c) => c.evidence_snippet && c.evidence_snippet.trim().length > 0)
      .map((c) => ({
        type: c.type,
        status: c.status,
        issuedAt: c.issued_at ?? null,
        expiresAt: c.expires_at ?? null,
        url: null,
      }));

  logger.info('Trust portal deep-scrape: completed', {
    vendorName,
    certificationCount: certifications.length,
    sectionCount: sections.length,
    initialMarkdownLength: initialMarkdown.length,
    combinedMarkdownLength: combinedMarkdown.length,
  });

  return certifications.length > 0 ? certifications : null;
}
