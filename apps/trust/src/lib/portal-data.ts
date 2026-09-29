import { cache } from 'react';
import { fetchTrust, orFallback } from './api';
import {
  customFrameworksSchema,
  customLinksSchema,
  faqsSchema,
  overviewSchema,
  summarySchema,
  vendorsSchema,
  type Summary,
} from './schemas';

const enc = encodeURIComponent;

/** Cached per request so layout, metadata and page share one API call. */
export const getSummary = cache(async (friendlyUrl: string): Promise<Summary | null> => {
  const result = await fetchTrust({
    path: `/${enc(friendlyUrl)}/summary`,
    schema: summarySchema,
  });
  return result.ok ? result.data : null;
});

export async function getPortalSections(friendlyUrl: string) {
  const base = `/${enc(friendlyUrl)}`;
  const [overview, faqs, vendors, links, frameworks] = await Promise.all([
    fetchTrust({ path: `${base}/overview`, schema: overviewSchema }),
    fetchTrust({ path: `${base}/faqs`, schema: faqsSchema }),
    fetchTrust({ path: `${base}/vendors`, schema: vendorsSchema }),
    fetchTrust({ path: `${base}/custom-links`, schema: customLinksSchema }),
    fetchTrust({
      path: `${base}/custom-frameworks`,
      schema: customFrameworksSchema,
    }),
  ]);

  return {
    overview: orFallback(overview, null),
    faqs: orFallback(faqs, { faqs: null }).faqs ?? [],
    vendors: orFallback(vendors, []),
    links: orFallback(links, []),
    customFrameworks: orFallback(frameworks, []),
  };
}
