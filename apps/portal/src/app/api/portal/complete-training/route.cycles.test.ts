import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Framework gates and renewal cycles for the portal's complete-training route.
// The base behaviour (auth, validation, membership, stamping) is covered in
// route.test.ts and the completion email in route.email.test.ts.

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  memberFindFirst: vi.fn(),
  frameworkInstanceFindFirst: vi.fn(),
  completionUpsert: vi.fn(),
  completionUpdate: vi.fn(),
  completionFindMany: vi.fn(),
  fetch: vi.fn(),
  afterTasks: [] as Array<() => unknown>,
  env: {
    SERVICE_TOKEN_PORTAL: undefined as string | undefined,
    NEXT_PUBLIC_API_URL: 'http://api.test',
  },
}));

vi.mock('@/app/lib/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock('@db/server', () => ({
  db: {
    member: { findFirst: mocks.memberFindFirst },
    frameworkInstance: { findFirst: mocks.frameworkInstanceFindFirst },
    employeeTrainingVideoCompletion: {
      upsert: mocks.completionUpsert,
      update: mocks.completionUpdate,
      findMany: mocks.completionFindMany,
    },
  },
}));

vi.mock('@/env.mjs', () => ({ env: mocks.env }));
vi.stubGlobal('fetch', mocks.fetch);

// The route defers the completion email with `after`; capture it so tests can
// run it explicitly after the response.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (task: () => unknown) => {
      mocks.afterTasks.push(task);
    },
  };
});

import { POST } from './route';

const DAY_MS = 24 * 60 * 60 * 1000;
const GENERAL = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'];

const completedRow = ({
  videoId,
  cycle = 1,
  days,
}: {
  videoId: string;
  cycle?: number;
  days: number;
}) => ({
  id: `etvc_${videoId}_${cycle}`,
  memberId: 'mem_1',
  videoId,
  cycle,
  dueAt: null,
  completedAt: new Date(Date.now() - days * DAY_MS),
});

const generalRows = ({ cycle = 1, days }: { cycle?: number; days: number }) =>
  GENERAL.map((videoId) => completedRow({ videoId, cycle, days }));

function post(videoId: string): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/portal/complete-training', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ videoId, organizationId: 'org_1' }),
    }),
  );
}

describe('POST /api/portal/complete-training: gates and renewal cycles', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.afterTasks.length = 0;
    mocks.env.SERVICE_TOKEN_PORTAL = undefined;

    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    mocks.memberFindFirst.mockResolvedValue({
      id: 'mem_1',
      userId: 'user_1',
      organizationId: 'org_1',
      role: 'employee',
      deactivated: false,
    });
    mocks.frameworkInstanceFindFirst.mockResolvedValue({ id: 'frm_1' });
    mocks.completionFindMany.mockResolvedValue([]);
    mocks.completionUpsert.mockImplementation(
      async ({ create }: { create: { videoId: string; cycle: number } }) =>
        completedRow({ videoId: create.videoId, cycle: create.cycle, days: 0 }),
    );
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
  });

  describe('framework gates', () => {
    // HIPAA eligibility must match the NestJS training service: an org without
    // the HIPAA framework cannot complete hipaa-sat-1, otherwise this route
    // would mint HIPAA completion records (and certificate artifacts) the
    // service would reject, desyncing the two paths.
    it('rejects hipaa-sat-1 when the org does not have the HIPAA framework', async () => {
      mocks.frameworkInstanceFindFirst.mockResolvedValue(null);

      const res = await post('hipaa-sat-1');

      expect(res.status).toBe(400);
      expect(mocks.frameworkInstanceFindFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org_1', framework: { name: 'HIPAA' } },
        select: { id: true },
      });
      expect(mocks.completionUpsert).not.toHaveBeenCalled();
    });

    it('marks hipaa-sat-1 complete when the org has the HIPAA framework', async () => {
      const res = await post('hipaa-sat-1');

      expect(res.status).toBe(200);
      expect(mocks.completionUpsert).toHaveBeenCalledWith({
        where: {
          memberId_videoId_cycle: { memberId: 'mem_1', videoId: 'hipaa-sat-1', cycle: 1 },
        },
        create: expect.objectContaining({ videoId: 'hipaa-sat-1', memberId: 'mem_1', cycle: 1 }),
        update: {},
      });
    });

    it('rejects a CCPA module when the org does not have the CCPA framework', async () => {
      mocks.frameworkInstanceFindFirst.mockResolvedValue(null);

      const res = await post('ccpa-1');

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('CCPA training is not available for this organization');
      expect(mocks.frameworkInstanceFindFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org_1', framework: { name: 'CCPA' } },
        select: { id: true },
      });
      expect(mocks.completionUpsert).not.toHaveBeenCalled();
    });

    it('marks a CCPA module complete when the org has the CCPA framework', async () => {
      const res = await post('ccpa-2');

      expect(res.status).toBe(200);
      expect(mocks.completionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            memberId_videoId_cycle: { memberId: 'mem_1', videoId: 'ccpa-2', cycle: 1 },
          },
        }),
      );
    });

    it('does not look up a framework for general training', async () => {
      await post('sat-1');

      expect(mocks.frameworkInstanceFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('renewal cycles', () => {
    it('records a renewal on cycle 2 once the renewal window has opened', async () => {
      mocks.completionFindMany.mockResolvedValue(generalRows({ days: 330 }));

      const res = await post('sat-1');

      expect(res.status).toBe(200);
      expect(mocks.completionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            memberId_videoId_cycle: { memberId: 'mem_1', videoId: 'sat-1', cycle: 2 },
          },
        }),
      );
    });

    it('records a renewal on cycle 2 for an expired member', async () => {
      mocks.completionFindMany.mockResolvedValue(generalRows({ days: 400 }));

      await post('sat-4');

      expect(mocks.completionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            memberId_videoId_cycle: { memberId: 'mem_1', videoId: 'sat-4', cycle: 2 },
          },
        }),
      );
    });

    it('does not start a renewal while the training is still comfortably valid', async () => {
      const rows = generalRows({ days: 30 });
      mocks.completionFindMany.mockResolvedValue(rows);

      const res = await post('sat-1');

      expect(res.status).toBe(200);
      expect((await res.json()).data.id).toBe(rows[0]?.id);
      expect(mocks.completionUpsert).not.toHaveBeenCalled();
    });

    it('returns the existing row for a module already completed in the active cycle', async () => {
      const rows = [completedRow({ videoId: 'sat-1', days: 3 })];
      mocks.completionFindMany.mockResolvedValue(rows);

      const res = await post('sat-1');

      expect(res.status).toBe(200);
      expect((await res.json()).data.id).toBe('etvc_sat-1_1');
      expect(mocks.completionUpsert).not.toHaveBeenCalled();
    });
  });
});
