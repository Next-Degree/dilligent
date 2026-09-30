import { describe, expect, it } from 'bun:test';
import { tlsConnectionsCheck } from '../checks';
import { MAX_DATABASES_PER_RUN } from '../scope';
import { filteredDatabasesVariable } from '../variables';
import { findByResourceId, httpError, makeDatabase, makeUpstashContext } from './harness';

const run = async (
  fixture: Parameters<typeof makeUpstashContext>[0],
  variables?: Parameters<typeof makeUpstashContext>[1],
) => {
  const recorded = makeUpstashContext(fixture, variables);
  await tlsConnectionsCheck.run(recorded.ctx);
  return recorded;
};

describe('Upstash scope resolution', () => {
  it('fails the run when the database listing itself is denied', async () => {
    const recorded = await run({ databases: httpError(401, 'Unauthorized') });

    const failure = findByResourceId(recorded.fails, 'databases');
    expect(failure?.title).toBe('Failed to list Upstash databases');
    expect(failure?.evidence).toMatchObject({ denied: true });
    expect(recorded.passes).toHaveLength(0);
  });

  it('fails when the key can see no databases at all', async () => {
    const recorded = await run({ databases: [] });

    expect(findByResourceId(recorded.fails, 'databases')?.title).toBe('No Upstash databases found');
    expect(recorded.passes).toHaveLength(0);
  });

  it('narrows to the selected databases in include mode', async () => {
    const recorded = await run(
      { databases: [makeDatabase({ database_id: 'db-a' }), makeDatabase({ database_id: 'db-b' })] },
      { database_filter_mode: 'include', filtered_databases: ['db-b'] },
    );

    expect(findByResourceId(recorded.passes, 'db-b')).toBeDefined();
    expect(findByResourceId(recorded.passes, 'db-a')).toBeUndefined();
  });

  it('excludes the selected databases in exclude mode', async () => {
    const recorded = await run(
      { databases: [makeDatabase({ database_id: 'db-a' }), makeDatabase({ database_id: 'db-b' })] },
      { database_filter_mode: 'exclude', filtered_databases: ['db-b'] },
    );

    expect(findByResourceId(recorded.passes, 'db-a')).toBeDefined();
    expect(findByResourceId(recorded.passes, 'db-b')).toBeUndefined();
  });

  it('fails rather than silently checking everything when a filter matches nothing', async () => {
    const recorded = await run(
      { databases: [makeDatabase({ database_id: 'db-a' })] },
      { database_filter_mode: 'include', filtered_databases: ['db-deleted'] },
    );

    expect(findByResourceId(recorded.fails, 'database-filter')?.title).toBe(
      'Database filter matched no databases',
    );
    expect(recorded.passes).toHaveLength(0);
  });

  it('records the databases a capped run did not reach, so the cap never reads as a pass', async () => {
    const databases = Array.from({ length: MAX_DATABASES_PER_RUN + 2 }, (_, i) =>
      makeDatabase({ database_id: `db-${i}` }),
    );
    const recorded = await run({ databases });

    const gap = findByResourceId(recorded.fails, 'database-coverage');
    expect(gap?.title).toBe('2 database(s) not checked');
    expect(gap?.evidence).toMatchObject({
      checkedDatabaseCount: MAX_DATABASES_PER_RUN,
      scopedDatabaseCount: MAX_DATABASES_PER_RUN + 2,
      maxDatabasesPerRun: MAX_DATABASES_PER_RUN,
    });
    expect(recorded.passes).toHaveLength(MAX_DATABASES_PER_RUN);
  });
});

describe('filteredDatabasesVariable.fetchOptions', () => {
  it('offers exactly the databases the checks see, via the same listing', async () => {
    // The picker used to re-implement the paging rules, so it could drift from
    // what the checks enumerate and offer the customer a different database set.
    const recorded = makeUpstashContext({
      databases: [
        makeDatabase({ database_id: 'db-b', database_name: 'beta' }),
        makeDatabase({ database_id: 'db-a', database_name: 'alpha' }),
      ],
    });

    const options = await filteredDatabasesVariable.fetchOptions!(recorded.ctx);

    expect(options).toEqual([
      { value: 'db-a', label: 'alpha' },
      { value: 'db-b', label: 'beta' },
    ]);
  });
});
