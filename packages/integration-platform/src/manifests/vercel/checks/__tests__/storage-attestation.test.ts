import { describe, expect, it } from 'bun:test';
import type { CheckPassingResult, IntegrationCheck } from '../../../../types';
import { classifyVercelStore } from '../../stores';
import type { VercelStore, VercelStoresResponse } from '../../types';
import {
  bucketEncryptedCheck,
  databasesEnforceSslCheck,
  nonRelationalDatabaseEncryptedCheck,
  relationalDatabaseEncryptedCheck,
} from '../storage-encryption';
import { findByResourceId, httpError, makeCheckContext } from './harness';

const TEAM_ID = 'team_1';

const makeStore = (overrides: Partial<VercelStore> = {}): VercelStore => ({
  id: 'store_1',
  name: 'store one',
  type: 'blob',
  status: 'available',
  ...overrides,
});

function run(
  check: IntegrationCheck,
  options: {
    stores: VercelStore[];
    storePages?: Record<string, VercelStoresResponse>;
    storesError?: Error;
  },
) {
  const recorded = makeCheckContext({
    teamId: TEAM_ID,
    handle: (path) => {
      if (path.startsWith('/v1/storage/stores')) {
        if (options.storesError) throw options.storesError;
        const until = new URL(path, 'https://api.vercel.com').searchParams.get('until');
        const page = options.storePages?.[until ?? 'first'];
        if (page) return page;
        return { stores: options.stores } satisfies VercelStoresResponse;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return check.run(recorded.ctx).then(() => recorded);
}

const storeResults = (results: CheckPassingResult[]) =>
  results.filter((result) => result.resourceType !== 'vercel').map((result) => result.resourceId);

describe('classifyVercelStore', () => {
  it('classifies the store types Vercel runs itself', () => {
    const classes = ['blob', 'postgres', 'redis', 'edge-config', 'global-config'].map(
      (type, index) => classifyVercelStore(makeStore({ type }), index).storeClass,
    );
    expect(classes).toEqual([
      'blob',
      'relational',
      'non-relational',
      'non-relational',
      'non-relational',
    ]);
  });

  it('classifies Marketplace stores by product slug and marks them third-party', () => {
    const neon = classifyVercelStore(
      makeStore({ type: 'integration', productSlug: 'neon-serverless-postgres' }),
      0,
    );
    expect(neon.storeClass).toBe('relational');
    expect(neon.isFirstParty).toBe(false);
    expect(neon.provider).toBe('neon-serverless-postgres');

    const upstash = classifyVercelStore(
      makeStore({ type: 'integration', product: { slug: 'upstash-redis' } }),
      0,
    );
    expect(upstash.storeClass).toBe('non-relational');
  });

  it('falls back to the store name, then to unknown', () => {
    expect(
      classifyVercelStore(makeStore({ type: 'integration', name: 'prod-mongodb' }), 0).storeClass,
    ).toBe('non-relational');
    expect(
      classifyVercelStore(makeStore({ type: 'integration', name: 'analytics' }), 0).storeClass,
    ).toBe('unknown');
  });

  it('treats a missing status as healthy but a suspended store as not', () => {
    expect(classifyVercelStore(makeStore({ status: null }), 0).healthy).toBe(true);
    expect(classifyVercelStore(makeStore({ status: 'suspended' }), 0).healthy).toBe(false);
  });
});

describe('bucketEncryptedCheck', () => {
  it('attests Blob stores Vercel runs and ignores other store classes', async () => {
    const recorded = await run(bucketEncryptedCheck, {
      stores: [
        makeStore({ id: 'store_blob', name: 'assets', type: 'blob' }),
        makeStore({ id: 'store_pg', name: 'db', type: 'postgres' }),
      ],
    });

    expect(storeResults(recorded.passes)).toEqual(['store_blob']);
    const pass = findByResourceId(recorded.passes, 'store_blob');
    expect(pass?.title).toBe('Encryption at rest confirmed: assets');
    expect(pass?.evidence).toMatchObject({ storeClass: 'blob', managedBy: 'vercel' });
    expect(recorded.fails).toHaveLength(0);
  });

  it('reports a Marketplace bucket rather than attesting someone else’s storage', async () => {
    const recorded = await run(bucketEncryptedCheck, {
      stores: [
        makeStore({ id: 'store_x', name: 'uploads', type: 'integration', productSlug: 'blob-co' }),
      ],
    });

    const finding = findByResourceId(recorded.fails, 'store_x');
    expect(finding?.title).toBe('Encryption at rest not verifiable: uploads');
    expect(finding?.severity).toBe('medium');
    expect(finding?.remediation).toContain('blob-co');
    expect(storeResults(recorded.passes)).toEqual([]);
  });

  it('reports a store that is not available instead of attesting it', async () => {
    const recorded = await run(bucketEncryptedCheck, {
      stores: [makeStore({ id: 'store_blob', name: 'assets', status: 'suspended' })],
    });

    const finding = findByResourceId(recorded.fails, 'store_blob');
    expect(finding?.title).toBe('Encryption at rest unconfirmed: assets');
    expect(finding?.severity).toBe('low');
  });

  it('surfaces stores it could not classify instead of dropping them silently', async () => {
    const recorded = await run(bucketEncryptedCheck, {
      stores: [makeStore({ id: 'store_x', name: 'analytics', type: 'integration' })],
    });

    const finding = findByResourceId(recorded.fails, 'bucket-encryption-unclassified');
    expect(finding?.severity).toBe('low');
    expect(finding?.evidence).toMatchObject({
      stores: [expect.objectContaining({ storeId: 'store_x' })],
    });
  });

  it('passes with an explicit empty inventory when the team has no buckets', async () => {
    const recorded = await run(bucketEncryptedCheck, { stores: [] });

    const summary = findByResourceId(recorded.passes, 'bucket-encryption');
    expect(summary?.description).toContain('no blob stores');
    expect(summary?.evidence).toMatchObject({ inScopeStores: 0, attestedStores: 0 });
  });

  it('fails loudly when the store list cannot be read', async () => {
    const recorded = await run(bucketEncryptedCheck, { stores: [], storesError: httpError(403) });

    const finding = findByResourceId(recorded.fails, 'bucket-encryption');
    expect(finding?.severity).toBe('high');
    expect(recorded.passes).toHaveLength(0);
  });

  it('follows the stores cursor', async () => {
    const recorded = await run(bucketEncryptedCheck, {
      stores: [],
      storePages: {
        first: { stores: [makeStore({ id: 'store_a' })], pagination: { next: 500 } },
        '500': { stores: [makeStore({ id: 'store_b' })], pagination: { next: null } },
      },
    });

    expect(storeResults(recorded.passes).sort()).toEqual(['store_a', 'store_b']);
  });
});

describe('database encryption checks', () => {
  const stores = [
    makeStore({ id: 'store_pg', name: 'orders', type: 'postgres' }),
    makeStore({ id: 'store_kv', name: 'sessions', type: 'redis' }),
    makeStore({ id: 'store_cfg', name: 'flags', type: 'edge-config' }),
    makeStore({ id: 'store_blob', name: 'assets', type: 'blob' }),
  ];

  it('scopes the relational check to SQL stores', async () => {
    const recorded = await run(relationalDatabaseEncryptedCheck, { stores });
    expect(storeResults(recorded.passes)).toEqual(['store_pg']);
  });

  it('scopes the non-relational check to key-value and config stores', async () => {
    const recorded = await run(nonRelationalDatabaseEncryptedCheck, { stores });
    expect(storeResults(recorded.passes)).toEqual(['store_kv', 'store_cfg']);
  });

  it('covers every database in the SSL check but no buckets', async () => {
    const recorded = await run(databasesEnforceSslCheck, { stores });

    expect(storeResults(recorded.passes)).toEqual(['store_pg', 'store_kv', 'store_cfg']);
    expect(findByResourceId(recorded.passes, 'store_pg')?.title).toBe(
      'TLS-only connections confirmed: orders',
    );
  });

  it('raises a high-severity finding for a Marketplace database the SSL check cannot verify', async () => {
    const recorded = await run(databasesEnforceSslCheck, {
      stores: [
        makeStore({ id: 'store_neon', name: 'main', type: 'integration', productSlug: 'neon' }),
      ],
    });

    const finding = findByResourceId(recorded.fails, 'store_neon');
    expect(finding?.title).toBe('TLS-only connections not verifiable: main');
    expect(finding?.severity).toBe('high');
  });
});

describe('store pagination safety', () => {
  it('stops when the stores cursor stops advancing', async () => {
    const recorded = await run(bucketEncryptedCheck, {
      stores: [],
      storePages: {
        first: { stores: [makeStore({ id: 'store_a' })], pagination: { next: 500 } },
        '500': { stores: [makeStore({ id: 'store_b' })], pagination: { next: 500 } },
      },
    });

    expect(recorded.requests.filter((path) => path.startsWith('/v1/storage/stores'))).toHaveLength(
      2,
    );
    expect(storeResults(recorded.passes).sort()).toEqual(['store_a', 'store_b']);
  });
});
