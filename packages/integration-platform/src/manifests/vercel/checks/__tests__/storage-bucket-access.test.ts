import { describe, expect, it } from 'bun:test';
import type { VercelStore, VercelStoresResponse } from '../../types';
import { storageBucketSecureAccessCheck } from '../storage-bucket-access';
import { findByResourceId, httpError, makeCheckContext } from './harness';

const TEAM_ID = 'team_1';

const makeBucket = (overrides: Partial<VercelStore> = {}): VercelStore => ({
  id: 'store_blob',
  name: 'assets',
  type: 'blob',
  status: 'available',
  ...overrides,
});

function run(options: { stores: VercelStore[]; storesError?: Error }) {
  const recorded = makeCheckContext({
    teamId: TEAM_ID,
    handle: (path) => {
      if (path.startsWith('/v1/storage/stores')) {
        if (options.storesError) throw options.storesError;
        return { stores: options.stores } satisfies VercelStoresResponse;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return storageBucketSecureAccessCheck.run(recorded.ctx).then(() => recorded);
}

describe('storageBucketSecureAccessCheck', () => {
  it('passes a private bucket', async () => {
    const recorded = await run({ stores: [makeBucket({ access: 'private' })] });

    const pass = findByResourceId(recorded.passes, 'store_blob');
    expect(pass?.title).toBe('Bucket access restricted: assets');
    expect(pass?.evidence).toMatchObject({ access: 'private' });
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails a public bucket', async () => {
    const recorded = await run({ stores: [makeBucket({ access: 'public' })] });

    const finding = findByResourceId(recorded.fails, 'store_blob');
    expect(finding?.title).toBe('Bucket serves objects publicly: assets');
    expect(finding?.severity).toBe('high');
    expect(finding?.remediation).toContain('private');
  });

  it('reports an unknown access model rather than assuming it is private', async () => {
    const recorded = await run({ stores: [makeBucket()] });

    const finding = findByResourceId(recorded.fails, 'store_blob');
    expect(finding?.title).toBe('Bucket access model unknown: assets');
    expect(finding?.severity).toBe('medium');
    expect(recorded.passes.filter((result) => result.resourceType === 'blob-store')).toHaveLength(
      0,
    );
  });

  it('reports a Marketplace bucket as unverifiable', async () => {
    const recorded = await run({
      stores: [
        makeBucket({
          id: 'store_x',
          type: 'integration',
          productSlug: 'blob-co',
          access: 'public',
        }),
      ],
    });

    const finding = findByResourceId(recorded.fails, 'store_x');
    expect(finding?.title).toBe('Bucket access model not verifiable: assets');
    expect(finding?.severity).toBe('medium');
    expect(finding?.remediation).toContain('blob-co');
  });

  it('ignores databases', async () => {
    const recorded = await run({
      stores: [makeBucket({ id: 'store_pg', type: 'postgres' })],
    });

    const summary = findByResourceId(recorded.passes, 'bucket-access');
    expect(summary?.description).toContain('no Blob stores');
    expect(summary?.evidence).toMatchObject({ bucketCount: 0, totalStores: 1 });
  });

  it('fails loudly when the store list cannot be read', async () => {
    const recorded = await run({ stores: [], storesError: httpError(403) });

    expect(findByResourceId(recorded.fails, 'bucket-access')?.severity).toBe('high');
    expect(recorded.passes).toHaveLength(0);
  });

  it('counts private buckets in the run summary', async () => {
    const recorded = await run({
      stores: [
        makeBucket({ id: 'store_a', access: 'private' }),
        makeBucket({ id: 'store_b', access: 'public' }),
      ],
    });

    expect(findByResourceId(recorded.passes, 'bucket-access')?.evidence).toMatchObject({
      bucketCount: 2,
      privateBucketCount: 1,
    });
  });
});
