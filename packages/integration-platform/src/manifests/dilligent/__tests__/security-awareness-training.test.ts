import { describe, expect, it } from 'bun:test';
import type {
  SecurityAwarenessTrainingRecords,
  TrainingParticipant,
} from '../../../training-types';
import type { CheckContext, CheckFindingResult, CheckPassingResult } from '../../../types';
import { securityAwarenessTrainingCheck } from '../checks';

const REQUIRED = ['sat-1', 'sat-2'];
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();
const FINISHED_AT = daysAgo(10);

const participant = (
  overrides: Partial<TrainingParticipant> & { id: string },
): TrainingParticipant => ({
  email: `${overrides.id}@acme.com`,
  name: null,
  joinedAt: daysAgo(200),
  completions: REQUIRED.map((moduleId) => ({ moduleId, completedAt: FINISHED_AT })),
  ...overrides,
});

const records = (
  overrides: Partial<SecurityAwarenessTrainingRecords> = {},
): SecurityAwarenessTrainingRecords => ({
  requiredModuleIds: REQUIRED,
  portalTrainingEnabled: true,
  participants: [participant({ id: 'mem_1' })],
  ...overrides,
});

const run = async (data: SecurityAwarenessTrainingRecords | null) => {
  const passes: CheckPassingResult[] = [];
  const fails: CheckFindingResult[] = [];
  const ctx = {
    log: () => {},
    warn: () => {},
    error: () => {},
    pass: (result: CheckPassingResult) => passes.push(result),
    fail: (finding: CheckFindingResult) => fails.push(finding),
    training: data ? { getSecurityAwarenessTraining: async () => data } : undefined,
  } as unknown as CheckContext;
  await securityAwarenessTrainingCheck.run(ctx);
  return { passes, fails };
};

const byId = <T extends { resourceId: string }>(results: T[], id: string) =>
  results.find((result) => result.resourceId === id);

describe('securityAwarenessTrainingCheck', () => {
  it('maps to the Security Awareness Training task', () => {
    expect(securityAwarenessTrainingCheck.taskMapping).toBe('frk_tt_698cacc0f06de04786d097ca');
  });

  it('passes everyone who completed the training, with auditable evidence', async () => {
    const { passes, fails } = await run(
      records({ participants: [participant({ id: 'mem_1', name: 'Ada Lovelace' })] }),
    );

    expect(fails).toHaveLength(0);
    const pass = byId(passes, 'mem_1');
    expect(pass?.title).toBe('Security awareness training complete: Ada Lovelace (mem_1@acme.com)');
    expect(pass?.resourceType).toBe('member');
    expect(pass?.evidence).toMatchObject({
      source: 'dilligent-employee-portal',
      memberId: 'mem_1',
      email: 'mem_1@acme.com',
      status: 'complete',
      requiredModules: REQUIRED,
      completedAt: FINISHED_AT,
      completedModules: REQUIRED.map((moduleId) => ({ moduleId, completedAt: FINISHED_AT })),
    });
  });

  it('fails someone who has not finished every module', async () => {
    const { fails } = await run(
      records({
        participants: [
          participant({
            id: 'mem_2',
            completions: [{ moduleId: 'sat-1', completedAt: daysAgo(3) }],
          }),
        ],
      }),
    );

    const finding = byId(fails, 'mem_2');
    expect(finding?.title).toBe('Security awareness training incomplete: mem_2@acme.com');
    expect(finding?.description).toContain('sat-2');
    expect(finding?.severity).toBe('medium');
    expect(finding?.evidence).toMatchObject({ status: 'incomplete', missingModuleIds: ['sat-2'] });
  });

  it('fails someone whose training is more than a year old', async () => {
    const { fails } = await run(
      records({
        participants: [
          participant({
            id: 'mem_3',
            completions: REQUIRED.map((moduleId) => ({ moduleId, completedAt: daysAgo(400) })),
          }),
        ],
      }),
    );

    const finding = byId(fails, 'mem_3');
    expect(finding?.title).toBe('Security awareness training expired: mem_3@acme.com');
    expect(finding?.remediation).toContain('exception');
  });

  it('passes a new joiner inside the onboarding window as due', async () => {
    const { passes, fails } = await run(
      records({
        participants: [participant({ id: 'mem_4', joinedAt: daysAgo(5), completions: [] })],
      }),
    );

    expect(fails).toHaveLength(0);
    const pass = byId(passes, 'mem_4');
    expect(pass?.title).toBe('Security awareness training due (onboarding): mem_4@acme.com');
    expect(pass?.evidence).toMatchObject({ status: 'onboarding', missingModuleIds: REQUIRED });
  });

  it('judges every participant independently', async () => {
    const { passes, fails } = await run(
      records({
        participants: [participant({ id: 'done' }), participant({ id: 'todo', completions: [] })],
      }),
    );

    expect(passes.map((p) => p.resourceId)).toEqual(['done']);
    expect(fails.map((f) => f.resourceId)).toEqual(['todo']);
  });

  it('fails the organization when portal training is turned off, and still judges people', async () => {
    const { passes, fails } = await run(records({ portalTrainingEnabled: false }));

    const finding = byId(fails, 'portal-security-training');
    expect(finding?.resourceType).toBe('organization');
    expect(finding?.remediation).toContain('Settings > Portal');
    expect(byId(passes, 'mem_1')).toBeDefined();
  });

  it('fails rather than passing on an empty roster', async () => {
    const { passes, fails } = await run(records({ participants: [] }));

    expect(passes).toHaveLength(0);
    expect(byId(fails, 'training-roster')?.title).toBe(
      'No people required to take security awareness training',
    );
  });

  it('errors the run when the host supplies no training records', async () => {
    await expect(run(null)).rejects.toThrow('Training records are not available');
  });

  it('errors the run when no modules are required', async () => {
    await expect(run(records({ requiredModuleIds: [] }))).rejects.toThrow(
      'No required security awareness training modules',
    );
  });
});
