import { describe, expect, it } from 'bun:test';
import { bucketEncryptionCheck, databaseEncryptionCheck } from '../checks';
import { findByResourceId, httpError, makeNeonContext, makeProject } from './harness';

describe('bucketEncryptionCheck', () => {
  it('evidences object-storage encryption per project and labels it as attested', async () => {
    const recorded = makeNeonContext({
      organizations: [],
      projects: [makeProject({ id: 'prj-a', name: 'alpha', synthetic_storage_size: 1024 })],
    });
    await bucketEncryptionCheck.run(recorded.ctx);

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.title).toBe('Object storage encrypted: alpha');
    expect(result?.evidence).toMatchObject({
      verification: 'provider-attested',
      algorithm: 'AES-256',
      storageLayer: 'object-storage',
      serverSideEncryption: true,
      syntheticStorageSizeBytes: 1024,
    });
    expect(result?.evidence.attestationSource).toBe(
      'https://neon.com/docs/security/security-overview',
    );
    expect(recorded.fails).toHaveLength(0);
  });

  it('summarises coverage so the attestation is tied to a named project set', async () => {
    const recorded = makeNeonContext({
      organizations: [],
      projects: [makeProject({ id: 'prj-a' }), makeProject({ id: 'prj-b' })],
    });
    await bucketEncryptionCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'bucket-encrypted')?.evidence).toMatchObject({
      coveredProjectCount: 2,
      totalProjectCount: 2,
      coveredProjectIds: ['prj-a', 'prj-b'],
    });
  });

  it('claims nothing when the project list cannot be read', async () => {
    const recorded = makeNeonContext({ organizations: [], projects: httpError(403) });
    await bucketEncryptionCheck.run(recorded.ctx);

    expect(recorded.passes).toHaveLength(0);
    expect(recorded.fails).toHaveLength(1);
  });
});

describe('databaseEncryptionCheck', () => {
  it('evidences database storage encryption with the key-management detail', async () => {
    const recorded = makeNeonContext({
      organizations: [],
      projects: [makeProject({ id: 'prj-a', name: 'alpha', settings: { hipaa: true } })],
    });
    await databaseEncryptionCheck.run(recorded.ctx);

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.title).toBe('Database encrypted: alpha');
    expect(result?.evidence).toMatchObject({
      verification: 'provider-attested',
      storageLayer: 'database',
      keyManagement: 'AWS KMS / Azure Key Vault',
      postgresVersion: 17,
      hipaaMode: true,
    });
  });
});
