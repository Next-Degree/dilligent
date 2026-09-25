import { describe, expect, it } from 'bun:test';
import { noPublicAccessCheck } from '../checks';
import { findByResourceId, makeDatabase, makeUpstashContext } from './harness';

describe('noPublicAccessCheck', () => {
  it('passes a database with IP allowlisting enabled', async () => {
    const recorded = makeUpstashContext({
      databases: [
        makeDatabase({
          database_id: 'db-1',
          database_name: 'prod',
          securityAddons: { ipWhitelisting: true },
        }),
      ],
    });
    await noPublicAccessCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'db-1')?.title).toBe('Access restricted: prod');
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails, at high severity, a database confirmed open to any IP', async () => {
    const recorded = makeUpstashContext({
      databases: [
        makeDatabase({
          database_id: 'db-1',
          database_name: 'prod',
          securityAddons: { ipWhitelisting: false },
        }),
      ],
    });
    await noPublicAccessCheck.run(recorded.ctx);

    const finding = findByResourceId(recorded.fails, 'db-1');
    expect(finding?.title).toBe('Open to public network access: prod');
    expect(finding?.severity).toBe('high');
    expect(recorded.passes).toHaveLength(0);
  });

  it('fails, at medium severity rather than assuming compliant, when securityAddons is missing', async () => {
    const database = makeDatabase({ database_id: 'db-1', database_name: 'prod' });
    delete database.securityAddons;
    const recorded = makeUpstashContext({ databases: [database] });
    await noPublicAccessCheck.run(recorded.ctx);

    const finding = findByResourceId(recorded.fails, 'db-1');
    expect(finding?.title).toBe('Access control unknown: prod');
    expect(finding?.severity).toBe('medium');
    expect(recorded.passes).toHaveLength(0);
  });
});
