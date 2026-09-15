import { describe, expect, it } from 'bun:test';
import { databaseEncryptionCheck } from '../checks';
import { findByResourceId, httpError, makeNeonContext, makeProject } from './harness';

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
    await databaseEncryptionCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'database-encrypted')?.evidence).toMatchObject({
      coveredProjectCount: 2,
      totalProjectCount: 2,
      coveredProjectIds: ['prj-a', 'prj-b'],
    });
  });

  it('claims nothing when the project list cannot be read', async () => {
    const recorded = makeNeonContext({ organizations: [], projects: httpError(403) });
    await databaseEncryptionCheck.run(recorded.ctx);

    expect(recorded.passes).toHaveLength(0);
    expect(recorded.fails).toHaveLength(1);
  });
});
