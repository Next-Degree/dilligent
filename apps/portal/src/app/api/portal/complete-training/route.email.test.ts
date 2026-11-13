import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Completion email decisions for the portal's complete-training route: it
// emails only when the request finished a cycle. The base behaviour is covered
// in route.test.ts and the gates and cycles in route.cycles.test.ts.

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

async function flushAfterTasks(): Promise<void> {
  await Promise.all(mocks.afterTasks.splice(0).map((task) => task()));
}

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

describe('POST /api/portal/complete-training: completion email', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.afterTasks.length = 0;
    // The emails are only sent when the portal has a service token for the API.
    mocks.env.SERVICE_TOKEN_PORTAL = 'svc-token';

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

  // Reads before the write see the state the route resolved against; reads
  // after it (the deferred email check) see the state including the write.
  const seedReads = ({ before, after }: { before: unknown[]; after: unknown[] }) => {
    mocks.completionFindMany.mockResolvedValueOnce(before).mockResolvedValue(after);
  };

  it('emails once the last general module of the first cycle is completed', async () => {
    const done = GENERAL.slice(0, 4).map((videoId) => completedRow({ videoId, days: 1 }));
    seedReads({ before: done, after: [...done, completedRow({ videoId: 'sat-5', days: 0 })] });

    await post('sat-5');
    await flushAfterTasks();

    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://api.test/v1/training/send-completion-email',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not email while the first cycle is still incomplete', async () => {
    const done = GENERAL.slice(0, 2).map((videoId) => completedRow({ videoId, days: 1 }));
    seedReads({ before: done, after: [...done, completedRow({ videoId: 'sat-3', days: 0 })] });

    await post('sat-3');
    await flushAfterTasks();

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not re-email while a renewal is only partly done, even though last year is complete', async () => {
    const lastYear = generalRows({ days: 330 });
    seedReads({
      before: lastYear,
      after: [...lastYear, completedRow({ videoId: 'sat-1', cycle: 2, days: 0 })],
    });

    await post('sat-1');
    await flushAfterTasks();

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('emails once the renewal cycle is finished', async () => {
    const lastYear = generalRows({ days: 330 });
    const renewed = GENERAL.slice(0, 4).map((videoId) =>
      completedRow({ videoId, cycle: 2, days: 1 }),
    );
    seedReads({
      before: [...lastYear, ...renewed],
      after: [...lastYear, ...renewed, completedRow({ videoId: 'sat-5', cycle: 2, days: 0 })],
    });

    await post('sat-5');
    await flushAfterTasks();

    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://api.test/v1/training/send-completion-email',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not email when the request was a no-op', async () => {
    mocks.completionFindMany.mockResolvedValue(generalRows({ days: 30 }));

    await post('sat-1');
    await flushAfterTasks();

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  // The completion email is best-effort, but a non-2xx response from the API
  // is a real delivery failure and must be logged. fetch does not reject on
  // 4xx/5xx, so before the fix the failure was silently treated as success.
  // Marking training complete must still succeed.
  it('logs when the HIPAA completion email request returns a non-2xx response', async () => {
    seedReads({ before: [], after: [completedRow({ videoId: 'hipaa-sat-1', days: 0 })] });
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    // console.error, not the dev-only `logger` util, so the failure is visible
    // in PRODUCTION.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post('hipaa-sat-1');

    // Completion is persisted regardless, and the response did not wait on
    // the email: the API call only happens once `after` is flushed.
    expect(res.status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();

    await flushAfterTasks();

    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://api.test/v1/training/send-hipaa-completion-email',
      // Bounded: Node's fetch otherwise waits ~5 minutes, keeping the
      // invocation alive long after the response was sent.
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Error triggering training completion email',
      expect.objectContaining({ memberId: 'mem_1' }),
    );

    errorSpy.mockRestore();
  });
});
