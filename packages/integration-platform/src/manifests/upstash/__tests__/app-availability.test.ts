import { describe, expect, it } from 'bun:test';
import { appAvailabilityCheck } from '../checks';
import { findByResourceId, makeDatabase, makeUpstashContext } from './harness';

describe('appAvailabilityCheck', () => {
  it('passes a database in state "active"', async () => {
    const recorded = makeUpstashContext({
      databases: [makeDatabase({ database_id: 'db-1', database_name: 'prod', state: 'active' })],
    });
    await appAvailabilityCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'db-1')?.title).toBe('Available: prod');
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails a database in a non-serving state', async () => {
    const recorded = makeUpstashContext({
      databases: [makeDatabase({ database_id: 'db-1', database_name: 'stale', state: 'deleted' })],
    });
    await appAvailabilityCheck.run(recorded.ctx);

    const finding = findByResourceId(recorded.fails, 'db-1');
    expect(finding?.title).toBe('Unavailable: stale');
    expect(finding?.description).toContain('deleted');
    expect(finding?.evidence).toMatchObject({ verification: 'api-verified' });
    expect(recorded.passes).toHaveLength(0);
  });

  it('fails rather than assumes available when the state field is missing', async () => {
    const database = makeDatabase({ database_id: 'db-1', database_name: 'prod' });
    delete database.state;
    const recorded = makeUpstashContext({ databases: [database] });
    await appAvailabilityCheck.run(recorded.ctx);

    const finding = findByResourceId(recorded.fails, 'db-1');
    expect(finding?.title).toBe('Unavailable: prod');
    // An unconfirmed field must never be reported alongside api-verified —
    // that would tell an auditor the opposite of what actually happened.
    expect(finding?.evidence).toMatchObject({ verification: 'unconfirmed' });
    expect(recorded.passes).toHaveLength(0);
  });

  it('fails the run when the account has no databases', async () => {
    const recorded = makeUpstashContext({ databases: [] });
    await appAvailabilityCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.fails, 'databases')?.title).toBe('No Upstash databases found');
  });
});
