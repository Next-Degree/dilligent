import { describe, expect, it } from 'bun:test';
import { auditLogsEnabledCheck } from '../checks';
import { findByResourceId, httpError, makeNeonContext, makeProject } from './harness';

const project = makeProject({ id: 'prj-a', name: 'alpha' });

const run = async (detail: Parameters<typeof makeNeonContext>[0]['projectDetail']) => {
  const recorded = makeNeonContext({
    organizations: [],
    projects: [project],
    projectDetail: detail,
  });
  await auditLogsEnabledCheck.run(recorded.ctx);
  return recorded;
};

describe('auditLogsEnabledCheck', () => {
  it('passes a project with an audit log level set', async () => {
    const recorded = await run({
      'prj-a': { ...project, settings: { audit_log_level: 'full', hipaa: false } },
    });

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.title).toBe('Audit logging enabled: alpha');
    expect(result?.evidence).toMatchObject({ verification: 'api-verified', auditLogLevel: 'full' });
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails a project with no audit log level at all', async () => {
    const recorded = await run({ 'prj-a': { ...project, settings: {} } });

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('Audit logging disabled: alpha');
    expect(failure?.evidence).toMatchObject({ auditLogLevel: null });
  });

  it.each(['off', 'none', 'disabled', '  '])(
    'treats %p as audit logging being off, not merely configured',
    async (level) => {
      const recorded = await run({
        'prj-a': { ...project, settings: { audit_log_level: level } },
      });

      expect(findByResourceId(recorded.fails, 'prj-a')?.title).toBe(
        'Audit logging disabled: alpha',
      );
    },
  );

  it('reads the setting from the project detail endpoint, not the trimmed list item', async () => {
    const recorded = await run({
      'prj-a': { ...project, settings: { audit_log_level: 'base' } },
    });

    expect(recorded.requests).toContain('projects/prj-a');
  });

  it('reports unknown rather than compliant when the project cannot be read', async () => {
    const recorded = await run({ 'prj-a': httpError(403) });

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('Audit logging status unknown: alpha');
    expect(failure?.evidence).toMatchObject({ denied: true });
    expect(recorded.passes).toHaveLength(0);
  });
});
