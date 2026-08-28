import { describe, expect, it } from 'bun:test';
import { appAvailabilityCheck, infrastructureInventoryCheck } from '../checks';
import { MAX_PROJECTS_PER_RUN } from '../scope';
import { parseRetentionDays } from '../variables';
import { findByResourceId, httpError, makeNeonContext, makeProject } from './harness';

const run = async (
  fixture: Parameters<typeof makeNeonContext>[0],
  variables?: Parameters<typeof makeNeonContext>[1],
) => {
  const recorded = makeNeonContext(fixture, variables);
  await infrastructureInventoryCheck.run(recorded.ctx);
  return recorded;
};

describe('Neon scope resolution', () => {
  it('deduplicates projects seen through both the un-scoped and org-scoped listings', async () => {
    const recorded = await run({
      organizations: [{ id: 'org-1', name: 'Acme' }],
      projects: [makeProject({ id: 'prj-a' }), makeProject({ id: 'prj-b' })],
    });

    const inventory = findByResourceId(recorded.passes, 'infrastructure-inventory');
    expect(inventory?.evidence).toMatchObject({ projectCount: 2, totalProjectCount: 2 });
    expect(recorded.passes.filter((p) => p.resourceType === 'neon_project')).toHaveLength(2);
  });

  it('still resolves projects when the key is organization-scoped and the user route is denied', async () => {
    const recorded = await run({ projects: [makeProject({ id: 'prj-a' })] });

    expect(recorded.requests).toContain('users/me/organizations');
    expect(findByResourceId(recorded.passes, 'prj-a')).toBeDefined();
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails the run when the project listing itself is denied', async () => {
    const recorded = await run({
      organizations: [{ id: 'org-1' }],
      projects: httpError(401, 'Unauthorized'),
    });

    const failure = findByResourceId(recorded.fails, 'projects');
    expect(failure?.title).toBe('Failed to list Neon projects');
    expect(failure?.evidence).toMatchObject({ denied: true });
    expect(recorded.passes).toHaveLength(0);
  });

  it('fails when the key can see no projects at all', async () => {
    const recorded = await run({ organizations: [], projects: [] });

    expect(findByResourceId(recorded.fails, 'projects')?.title).toBe('No Neon projects found');
    expect(recorded.passes).toHaveLength(0);
  });

  it('reports projects Neon admitted it could not read, so a partial run is not a clean one', async () => {
    const recorded = await run({
      organizations: [],
      projects: [makeProject({ id: 'prj-a' })],
      unavailableProjectIds: ['prj-hidden'],
    });

    const gap = findByResourceId(recorded.fails, 'project-coverage');
    expect(gap?.evidence).toMatchObject({ unavailableProjectIds: ['prj-hidden'] });
    // The readable project is still evidenced — a gap narrows coverage, it does not void it.
    expect(findByResourceId(recorded.passes, 'prj-a')).toBeDefined();
  });

  it('narrows to the selected projects in include mode', async () => {
    const recorded = await run(
      {
        organizations: [],
        projects: [makeProject({ id: 'prj-a' }), makeProject({ id: 'prj-b' })],
      },
      { project_filter_mode: 'include', filtered_projects: ['prj-b'] },
    );

    expect(findByResourceId(recorded.passes, 'prj-b')).toBeDefined();
    expect(findByResourceId(recorded.passes, 'prj-a')).toBeUndefined();
  });

  it('records the projects a capped run did not reach, so the cap never reads as a pass', async () => {
    // The inventory check is uncapped (it issues no per-project request), so the
    // cap is exercised through a check that does read per project.
    const projects = Array.from({ length: MAX_PROJECTS_PER_RUN + 2 }, (_, i) =>
      makeProject({ id: `prj-${i}` }),
    );
    const recorded = makeNeonContext({ organizations: [], projects });
    await appAvailabilityCheck.run(recorded.ctx);

    const gap = findByResourceId(recorded.fails, 'project-coverage');
    expect(gap?.title).toBe('2 project(s) not checked');
    expect(gap?.evidence).toMatchObject({
      checkedProjectCount: MAX_PROJECTS_PER_RUN,
      scopedProjectCount: MAX_PROJECTS_PER_RUN + 2,
      maxProjectsPerRun: MAX_PROJECTS_PER_RUN,
    });
  });

  it('fails rather than silently checking everything when a filter matches nothing', async () => {
    const recorded = await run(
      { organizations: [], projects: [makeProject({ id: 'prj-a' })] },
      { project_filter_mode: 'include', filtered_projects: ['prj-deleted'] },
    );

    expect(findByResourceId(recorded.fails, 'project-filter')?.title).toBe(
      'Project filter matched no projects',
    );
    expect(recorded.passes).toHaveLength(0);
  });
});

describe('parseRetentionDays', () => {
  it('reads a configured threshold', () => {
    expect(parseRetentionDays({ minimum_retention_days: 14 })).toBe(14);
    expect(parseRetentionDays({ minimum_retention_days: '35' })).toBe(35);
  });

  it('falls back to 28 days for blank, zero, or unparseable input', () => {
    expect(parseRetentionDays(undefined)).toBe(28);
    expect(parseRetentionDays({ minimum_retention_days: '' })).toBe(28);
    expect(parseRetentionDays({ minimum_retention_days: 'soon' })).toBe(28);
    expect(parseRetentionDays({ minimum_retention_days: 0 })).toBe(28);
  });
});
