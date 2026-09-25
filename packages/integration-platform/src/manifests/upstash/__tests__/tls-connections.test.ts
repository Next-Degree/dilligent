import { describe, expect, it } from 'bun:test';
import { tlsConnectionsCheck } from '../checks';
import { findByResourceId, makeDatabase, makeUpstashContext } from './harness';

describe('tlsConnectionsCheck', () => {
  it('passes a database with TLS enabled', async () => {
    const recorded = makeUpstashContext({
      databases: [makeDatabase({ database_id: 'db-1', database_name: 'prod', tls: true })],
    });
    await tlsConnectionsCheck.run(recorded.ctx);

    const result = findByResourceId(recorded.passes, 'db-1');
    expect(result?.title).toBe('TLS enabled: prod');
    expect(result?.evidence).toMatchObject({ verification: 'api-verified', tls: true });
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails, at high severity, a database with TLS explicitly disabled', async () => {
    const recorded = makeUpstashContext({
      databases: [makeDatabase({ database_id: 'db-1', database_name: 'prod', tls: false })],
    });
    await tlsConnectionsCheck.run(recorded.ctx);

    const finding = findByResourceId(recorded.fails, 'db-1');
    expect(finding?.title).toBe('TLS not enabled: prod');
    expect(finding?.severity).toBe('high');
    expect(finding?.evidence).toMatchObject({ verification: 'api-verified' });
    expect(recorded.passes).toHaveLength(0);
  });

  it('fails, at medium severity rather than assuming compliant, when the field is missing', async () => {
    const database = makeDatabase({ database_id: 'db-1', database_name: 'prod' });
    delete database.tls;
    const recorded = makeUpstashContext({ databases: [database] });
    await tlsConnectionsCheck.run(recorded.ctx);

    const finding = findByResourceId(recorded.fails, 'db-1');
    expect(finding?.title).toBe('TLS status unknown: prod');
    expect(finding?.severity).toBe('medium');
    // An unconfirmed field must never be reported alongside api-verified —
    // that would tell an auditor the opposite of what actually happened.
    expect(finding?.evidence).toMatchObject({ verification: 'unconfirmed' });
    expect(recorded.passes).toHaveLength(0);
  });

  it('never includes secret fields in evidence', async () => {
    const database = makeDatabase({ database_id: 'db-1', database_name: 'prod' });
    const recorded = makeUpstashContext({ databases: [database] });
    await tlsConnectionsCheck.run(recorded.ctx);

    const evidence = findByResourceId(recorded.passes, 'db-1')?.evidence;
    expect(evidence).toBeDefined();
    expect(JSON.stringify(evidence)).not.toContain('rest_token');
    expect(JSON.stringify(evidence)).not.toContain('password');
  });
});
