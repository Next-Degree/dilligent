import { describe, expect, it } from 'bun:test';
import { appAvailabilityCheck, employeeAccessCheck } from '../checks';
import type { RailwayWorkspace } from '../types';
import {
  WORKSPACE,
  findByResourceId,
  makeEnvironment,
  makeInstance,
  makePerson,
  makeProject,
  makeRailwayContext,
} from './harness';

const workspace: RailwayWorkspace = {
  ...WORKSPACE,
  has2FAEnforcement: true,
  members: [
    { id: 'u1', email: 'Active@Acme.com', role: 'MEMBER', twoFactorAuthEnabled: true },
    { id: 'u2', email: 'leaver@acme.com', role: 'ADMIN', twoFactorAuthEnabled: true },
    { id: 'u3', email: 'stranger@gmail.com', role: 'MEMBER', twoFactorAuthEnabled: true },
  ],
};

describe('employeeAccessCheck', () => {
  it('passes employees and flags leavers and unknown accounts', async () => {
    const recorded = makeRailwayContext({
      tokenWorkspaces: [WORKSPACE],
      workspaces: { [WORKSPACE.id]: workspace },
      people: [
        makePerson({ email: 'active@acme.com' }),
        makePerson({ email: 'leaver@acme.com', isActive: false }),
      ],
    });
    await employeeAccessCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'ws-1:u1')?.title).toBe('Employee: Active@Acme.com');
    expect(findByResourceId(recorded.fails, 'ws-1:u2')?.severity).toBe('critical');
    expect(findByResourceId(recorded.fails, 'ws-1:u3')?.title).toBe(
      'Not a known employee: stranger@gmail.com',
    );
  });

  it('matches a linked GitHub email', async () => {
    const recorded = makeRailwayContext({
      tokenWorkspaces: [WORKSPACE],
      workspaces: { [WORKSPACE.id]: workspace },
      people: [
        makePerson({
          email: 'jo@acme.com',
          linkedEmails: [{ source: 'github', email: 'stranger@gmail.com' }],
        }),
      ],
    });
    await employeeAccessCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'ws-1:u3')).toBeDefined();
  });

  it('fails once, without judging anyone, when there is no directory', async () => {
    const recorded = makeRailwayContext({
      tokenWorkspaces: [WORKSPACE],
      workspaces: { [WORKSPACE.id]: workspace },
    });
    await employeeAccessCheck.run(recorded.ctx);

    expect(recorded.fails).toHaveLength(1);
    expect(recorded.fails[0]?.resourceId).toBe('people-directory');
    expect(recorded.passes).toHaveLength(0);
  });
});

const runAvailability = async (projects: ReturnType<typeof makeProject>[]) => {
  const recorded = makeRailwayContext({
    tokenWorkspaces: [WORKSPACE],
    projectPages: { [WORKSPACE.id]: [{ projects }] },
  });
  await appAvailabilityCheck.run(recorded.ctx);
  return recorded;
};

describe('appAvailabilityCheck', () => {
  it('passes a live production service and ignores staging and PR environments', async () => {
    const recorded = await runAvailability([
      makeProject({ id: 'p1' }, [
        makeEnvironment({ id: 'prod' }, [makeInstance({ serviceId: 'api' })]),
        makeEnvironment({ id: 'stg', name: 'staging' }, [
          makeInstance({
            serviceId: 'api',
            latestDeployment: { id: 'x', status: 'CRASHED', createdAt: '' },
          }),
        ]),
        makeEnvironment({ id: 'pr', name: 'production-pr-12', isEphemeral: true }, [
          makeInstance({
            serviceId: 'api',
            latestDeployment: { id: 'y', status: 'FAILED', createdAt: '' },
          }),
        ]),
      ]),
    ]);

    expect(findByResourceId(recorded.passes, 'prod:api')).toBeDefined();
    expect(recorded.fails).toHaveLength(0);
  });

  it('treats the primary environment as production whatever its name', async () => {
    const recorded = await runAvailability([
      makeProject({ id: 'p1', primaryEnvironmentId: 'main' }, [
        makeEnvironment({ id: 'main', name: 'main' }, [
          makeInstance({
            serviceId: 'api',
            latestDeployment: { id: 'x', status: 'CRASHED', createdAt: '' },
          }),
        ]),
      ]),
    ]);

    expect(findByResourceId(recorded.fails, 'main:api')?.severity).toBe('high');
  });

  it('passes when a failed release sits on top of a still-serving deployment', async () => {
    const recorded = await runAvailability([
      makeProject({ id: 'p1' }, [
        makeEnvironment({ id: 'prod' }, [
          makeInstance({
            serviceId: 'api',
            latestDeployment: { id: 'new', status: 'FAILED', createdAt: '' },
            activeDeployments: [{ id: 'old', status: 'SUCCESS', createdAt: '' }],
          }),
        ]),
      ]),
    ]);

    expect(findByResourceId(recorded.passes, 'prod:api')).toBeDefined();
  });

  it('skips cron services and reports a never-deployed service at low severity', async () => {
    const recorded = await runAvailability([
      makeProject({ id: 'p1' }, [
        makeEnvironment({ id: 'prod' }, [
          makeInstance({ serviceId: 'job', cronSchedule: '0 * * * *', latestDeployment: null }),
          makeInstance({ serviceId: 'web', latestDeployment: null }),
        ]),
      ]),
    ]);

    expect(findByResourceId(recorded.fails, 'prod:job')).toBeUndefined();
    expect(findByResourceId(recorded.fails, 'prod:web')?.severity).toBe('low');
  });

  it('fails the workspace when no production service exists', async () => {
    const recorded = await runAvailability([
      makeProject({ id: 'p1' }, [
        makeEnvironment({ id: 'dev', name: 'development' }, [makeInstance({ serviceId: 'api' })]),
      ]),
    ]);

    expect(findByResourceId(recorded.fails, 'ws-1:production')).toBeDefined();
  });
});
