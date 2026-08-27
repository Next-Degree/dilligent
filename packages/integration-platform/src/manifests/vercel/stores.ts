import type { CheckContext } from '../../types';
import { withTeamId } from './team';
import type { VercelStore, VercelStoresResponse } from './types';

const STORES_PAGE_SIZE = 100;
const MAX_STORE_PAGES = 20;

/**
 * How a store is treated by the storage checks.
 *
 * - `blob` — an object store (a "bucket").
 * - `relational` — a SQL database.
 * - `non-relational` — a key/value, document or config store.
 * - `unknown` — the engine class could not be determined from what Vercel
 *   reports. Never silently dropped: every check that scopes to a class also
 *   reports the stores it could not classify, because an unclassified store is
 *   a coverage gap, not a pass.
 */
export type VercelStoreClass = 'blob' | 'relational' | 'non-relational' | 'unknown';

/** Store types Vercel runs itself, and the class each one belongs to. */
const FIRST_PARTY_CLASSES: Readonly<Record<string, VercelStoreClass>> = {
  blob: 'blob',
  'edge-config': 'non-relational',
  'global-config': 'non-relational',
  kv: 'non-relational',
  postgres: 'relational',
  redis: 'non-relational',
};

/**
 * Marketplace products whose engine class is known. Matched against the
 * product slug Vercel reports for an `integration` store, then against the
 * store name as a fallback — Vercel does not always populate the slug.
 */
const MARKETPLACE_CLASSES: ReadonlyArray<readonly [RegExp, VercelStoreClass]> = [
  [/postgres|neon|supabase|planetscale|cockroach|mysql|turso|singlestore|nile/, 'relational'],
  [/redis|upstash|mongo|dynamo|cassandra|elastic|fauna|convex|dragonfly/, 'non-relational'],
  [/blob|bucket|s3|object-storage/, 'blob'],
];

/** Statuses that mean the store is running normally. */
const HEALTHY_STATUSES: ReadonlySet<string> = new Set(['available', 'initializing', 'onboarding']);

export interface ClassifiedVercelStore {
  store: VercelStore;
  /** Store id, or a stable synthetic id when Vercel omits one. */
  id: string;
  name: string;
  type: string;
  storeClass: VercelStoreClass;
  /**
   * True when Vercel itself runs the store. Marketplace stores are run by a
   * third party, so Vercel's API says nothing about how they encrypt data.
   */
  isFirstParty: boolean;
  /** Marketplace product backing the store, when it is not first-party. */
  provider: string | null;
  status: string | null;
  healthy: boolean;
}

/** The product slug for a Marketplace store, from whichever field carries it. */
function providerSlug(store: VercelStore): string | null {
  const slug = store.productSlug ?? store.product?.slug ?? store.product?.name;
  return typeof slug === 'string' && slug.length > 0 ? slug : null;
}

function classifyMarketplace(store: VercelStore): VercelStoreClass {
  const haystack = `${providerSlug(store) ?? ''} ${store.name ?? ''}`.toLowerCase();
  for (const [pattern, storeClass] of MARKETPLACE_CLASSES) {
    if (pattern.test(haystack)) return storeClass;
  }
  return 'unknown';
}

export function classifyVercelStore(store: VercelStore, index: number): ClassifiedVercelStore {
  const type = typeof store.type === 'string' ? store.type : 'unknown';
  const firstPartyClass = FIRST_PARTY_CLASSES[type];
  const isFirstParty = firstPartyClass !== undefined;
  const status = typeof store.status === 'string' ? store.status : null;

  return {
    store,
    id: store.id ?? `store-${index}`,
    name: store.name ?? store.id ?? `store-${index}`,
    type,
    storeClass: firstPartyClass ?? classifyMarketplace(store),
    isFirstParty,
    provider: isFirstParty ? null : providerSlug(store),
    status,
    // No status at all is treated as healthy: Vercel omits it on some store
    // shapes, and an absent field is not evidence of a problem.
    healthy: status === null || HEALTHY_STATUSES.has(status),
  };
}

/**
 * Every storage store on the team — Vercel Blob, Postgres, Redis/KV, Edge
 * Config and Marketplace stores alike. Paginates on the cursor Vercel returns
 * as `pagination.next`, which it accepts back as `until`.
 */
export async function fetchAllVercelStores(
  ctx: CheckContext,
  teamId?: string,
): Promise<ClassifiedVercelStore[]> {
  const stores: VercelStore[] = [];
  const seen = new Set<string>();
  const seenCursors = new Set<string>();
  let until: string | undefined;

  for (let page = 0; page < MAX_STORE_PAGES; page++) {
    const params = withTeamId(new URLSearchParams({ limit: String(STORES_PAGE_SIZE) }), teamId);
    if (until !== undefined) {
      params.set('until', until);
    }

    const response = await ctx.fetch<VercelStoresResponse>(
      `/v1/storage/stores?${params.toString()}`,
    );
    for (const store of response.stores ?? []) {
      // Stores without an id cannot be de-duplicated, so keep them all rather
      // than collapsing distinct stores into one.
      if (!store.id) {
        stores.push(store);
        continue;
      }
      if (!seen.has(store.id)) {
        seen.add(store.id);
        stores.push(store);
      }
    }

    const next = response.pagination?.next;
    if (typeof next !== 'number' && typeof next !== 'string') {
      break;
    }
    // Stop if the cursor stops advancing rather than re-reading page one until
    // the page cap: a repeated cursor means the endpoint ignored `until`.
    until = String(next);
    if (seenCursors.has(until)) {
      break;
    }
    seenCursors.add(until);
  }

  return stores.map(classifyVercelStore);
}

/** Inventory fields worth recording on every finding about a store. */
export function storeEvidence(store: ClassifiedVercelStore): Record<string, unknown> {
  return {
    storeId: store.id,
    storeName: store.name,
    storeType: store.type,
    storeClass: store.storeClass,
    managedBy: store.isFirstParty ? 'vercel' : (store.provider ?? 'marketplace-provider'),
    status: store.status,
    region: store.store.region ?? null,
    connectedProjects:
      store.store.totalConnectedProjects ?? store.store.projectsMetadata?.length ?? null,
  };
}
