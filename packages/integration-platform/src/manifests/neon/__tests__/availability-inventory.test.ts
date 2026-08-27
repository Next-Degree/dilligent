import { describe, expect, it } from 'bun:test';
import { appAvailabilityCheck, infrastructureInventoryCheck } from '../checks';
import { findByResourceId, httpError, makeEndpoint, makeNeonContext, makeProject } from './harness';

const project = makeProject({ id: 'prj-a', name: 'alpha' });

const runAvailability = async (endpoints: Parameters<typeof makeNeonContext>[0]['endpoints']) => {
  const recorded = makeNeonContext({ organizations: [], projects: [project], endpoints });
  await appAvailabilityCheck.run(recorded.ctx);
  return recorded;
};

describe('appAvailabilityCheck', () => {
  it('treats an idle compute as available, because Neon scales to zero', async () => {
    const recorded = await runAvailability({
      'prj-a': [makeEndpoint({ id: 'ep-1', current_state: 'idle' })],
    });

    expect(findByResourceId(recorded.passes, 'prj-a')?.title).toBe('Available: alpha');
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails a project whose only read-write compute is disabled', async () => {
    const recorded = await runAvailability({
      'prj-a': [makeEndpoint({ id: 'ep-1', disabled: true })],
    });

    expect(findByResourceId(recorded.fails, 'prj-a')?.title).toBe('Unavailable: alpha');
  });

  it('does not count a read-only replica as serving the application', async () => {
    const recorded = await runAvailability({
      'prj-a': [makeEndpoint({ id: 'ep-ro', type: 'read_only' })],
    });

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.evidence).toMatchObject({ servingEndpointCount: 1, readWriteEndpointCount: 0 });
  });

  it('fails a project with no computes at all', async () => {
    const recorded = await runAvailability({ 'prj-a': [] });

    expect(findByResourceId(recorded.fails, 'prj-a')?.description).toContain(
      'no compute endpoints',
    );
  });

  it('reports unknown when endpoints cannot be listed', async () => {
    const recorded = await runAvailability({ 'prj-a': httpError(500, 'Server error') });

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('Availability unknown: alpha');
    expect(failure?.evidence).toMatchObject({ denied: false });
  });
});

describe('infrastructureInventoryCheck', () => {
  it('records each project with the region and Postgres version', async () => {
    const recorded = makeNeonContext({
      organizations: [{ id: 'org-1' }],
      projects: [makeProject({ id: 'prj-a', name: 'alpha', region_id: 'aws-eu-central-1' })],
    });
    await infrastructureInventoryCheck.run(recorded.ctx);

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.title).toBe('Neon project: alpha');
    expect(result?.description).toContain('aws-eu-central-1');
    expect(result?.evidence).toMatchObject({ postgresVersion: 17, verification: 'api-verified' });
  });

  it('summarises the regions in use across the inventory', async () => {
    const recorded = makeNeonContext({
      organizations: [{ id: 'org-1' }],
      projects: [
        makeProject({ id: 'prj-a', region_id: 'aws-us-east-2' }),
        makeProject({ id: 'prj-b', region_id: 'azure-eastus2' }),
      ],
    });
    await infrastructureInventoryCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'infrastructure-inventory')?.evidence).toMatchObject({
      regions: ['aws-us-east-2', 'azure-eastus2'],
      organizationIds: ['org-1'],
    });
  });
});
