import { describe, expect, it } from 'bun:test';
import { bucketEncryptionCheck } from '../checks';
import type { NeonFixture } from './harness';
import {
  findByResourceId,
  httpError,
  makeBranch,
  makeNeonContext,
  makeProject,
  storageNotEnabled,
} from './harness';

const BRANCH_KEY = 'prj-a:br-main';

const withStorage = (overrides: Partial<NeonFixture> = {}): NeonFixture => ({
  organizations: [],
  projects: [makeProject({ id: 'prj-a', name: 'alpha' })],
  branches: { 'prj-a': [makeBranch({ id: 'br-main', name: 'main' })] },
  storage: { [BRANCH_KEY]: { enabled: true } },
  ...overrides,
});

const run = async (fixture: NeonFixture) => {
  const recorded = makeNeonContext(fixture);
  await bucketEncryptionCheck.run(recorded.ctx);
  return recorded;
};

describe('bucketEncryptionCheck', () => {
  it('evidences encryption against each named bucket, not the platform in the abstract', async () => {
    const recorded = await run(
      withStorage({
        buckets: {
          [BRANCH_KEY]: [
            { name: 'backups', access_level: 'private', created_at: '2026-01-01T00:00:00Z' },
          ],
        },
      }),
    );

    const result = findByResourceId(recorded.passes, 'prj-a/backups');
    expect(result?.title).toBe('Bucket encrypted: backups');
    expect(result?.evidence).toMatchObject({
      verification: 'provider-attested',
      bucketName: 'backups',
      accessLevel: 'private',
      branchId: 'br-main',
    });
    // The evidence must name Neon as the party making the encryption claim,
    // and say plainly that this check did not verify it.
    expect(result?.evidence.attestation).toMatchObject({
      attestedBy: 'Neon',
      attestationType: 'vendor-published-documentation',
      independentlyVerified: false,
      algorithm: 'AES-256',
      source: 'https://neon.com/docs/security/security-overview',
      sourceCheckedOn: '2026-09-15',
    });
    expect(result?.description).toContain('Neon attests:');
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails a publicly readable bucket while still evidencing its encryption', async () => {
    const recorded = await run(
      withStorage({
        buckets: {
          [BRANCH_KEY]: [
            { name: 'avatars', access_level: 'public_read' },
            { name: 'backups', access_level: 'private' },
          ],
        },
      }),
    );

    const failure = findByResourceId(recorded.fails, 'prj-a/avatars');
    expect(failure?.title).toBe('Bucket is publicly readable: avatars');
    expect(failure?.severity).toBe('high');
    // A public access level was read from the API — it is not Neon's claim.
    expect(failure?.evidence).toMatchObject({ verification: 'api-verified' });
    // The private bucket alongside it is untouched — this is why sampling one
    // bucket would be unsound.
    expect(findByResourceId(recorded.fails, 'prj-a/backups')).toBeUndefined();
    expect(findByResourceId(recorded.passes, 'prj-a/backups')).toBeDefined();
  });

  it('catches a future access level that is public but not spelled public_read', async () => {
    const recorded = await run(
      withStorage({
        buckets: { [BRANCH_KEY]: [{ name: 'wide', access_level: 'PUBLIC_READ_WRITE' }] },
      }),
    );

    expect(findByResourceId(recorded.fails, 'prj-a/wide')?.title).toBe(
      'Bucket is publicly readable: wide',
    );
  });

  it('treats an org without the feature as not applicable, never as a failure', async () => {
    const recorded = await run(withStorage({ storage: {} }));

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.title).toBe('No object storage in use: alpha');
    expect(result?.evidence).toMatchObject({
      objectStorageEnabled: false,
      storageReason: 'org_not_entitled',
      bucketCount: 0,
    });
    expect(recorded.fails).toHaveLength(0);
  });

  it.each(['region_unavailable', 'branch_directory_missing'])(
    'treats %p as the feature being off rather than a read problem',
    async (reason) => {
      const recorded = await run(
        withStorage({ storage: { [BRANCH_KEY]: storageNotEnabled(reason) } }),
      );

      expect(findByResourceId(recorded.passes, 'prj-a')?.evidence).toMatchObject({
        storageReason: reason,
      });
      expect(recorded.fails).toHaveLength(0);
    },
  );

  it('reports branch_not_found as unknown, because access may have been lost', async () => {
    const recorded = await run(
      withStorage({ storage: { [BRANCH_KEY]: storageNotEnabled('branch_not_found') } }),
    );

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('Bucket encryption unknown: alpha');
    expect(failure?.evidence).toMatchObject({ storageReason: 'branch_not_found' });
  });

  it('passes a project whose object storage is on but holds no buckets', async () => {
    const recorded = await run(withStorage({ buckets: { [BRANCH_KEY]: [] } }));

    expect(findByResourceId(recorded.passes, 'prj-a')?.title).toBe('No buckets to encrypt: alpha');
    expect(recorded.fails).toHaveLength(0);
  });

  it('claims nothing when the bucket listing itself fails', async () => {
    const recorded = await run(withStorage({ buckets: { [BRANCH_KEY]: httpError(403) } }));

    expect(findByResourceId(recorded.fails, 'prj-a')?.title).toBe(
      'Bucket encryption unknown: alpha',
    );
    expect(recorded.passes.filter((p) => p.resourceType === 'neon_bucket')).toHaveLength(0);
  });

  it('fails fast when no branch is flagged default, rather than guessing one', async () => {
    const recorded = await run(
      withStorage({
        branches: { 'prj-a': [makeBranch({ id: 'br-dev', default: undefined })] },
      }),
    );

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('Bucket encryption unknown: alpha');
    expect(failure?.description).toContain('no default branch');
  });

  it('summarises bucket coverage including the public count', async () => {
    const recorded = await run(
      withStorage({
        buckets: {
          [BRANCH_KEY]: [
            { name: 'avatars', access_level: 'public_read' },
            { name: 'backups', access_level: 'private' },
          ],
        },
      }),
    );

    expect(findByResourceId(recorded.passes, 'bucket-encrypted')?.evidence).toMatchObject({
      bucketCount: 2,
      publiclyReadableBucketCount: 1,
      projectsWithObjectStorage: 1,
      checkedProjectCount: 1,
    });
  });
});
