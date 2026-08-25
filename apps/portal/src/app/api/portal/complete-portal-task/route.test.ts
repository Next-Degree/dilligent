import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Portal self-service must NOT depend on the employee's org RBAC role: this
// route authorizes on session + organization membership only, mirroring
// complete-training and accept-policies. An employee on a custom role without
// `portal:update` must still be able to complete their own portal tasks.

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  memberFindFirst: vi.fn(),
  portalTaskFindFirst: vi.fn(),
  completionUpsert: vi.fn(),
}));

vi.mock('@/app/lib/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock('@db/server', () => ({
  db: {
    member: { findFirst: mocks.memberFindFirst },
    portalTask: { findFirst: mocks.portalTaskFindFirst },
    portalTaskCompletion: { upsert: mocks.completionUpsert },
  },
}));

const { POST } = await import('./route');

const buildRequest = (body: unknown) =>
  new NextRequest('http://portal.test/api/portal/complete-portal-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const validBody = { portalTaskId: 'ptsk_1', organizationId: 'org_1' };

describe('POST /api/portal/complete-portal-task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: 'usr_1' } });
    mocks.memberFindFirst.mockResolvedValue({ id: 'mem_1' });
    mocks.portalTaskFindFirst.mockResolvedValue({
      id: 'ptsk_1',
      acknowledgementText: 'I agree.',
    });
    mocks.completionUpsert.mockResolvedValue({ id: 'ptc_1' });
  });

  it('records the completion and snapshots the acknowledgement wording', async () => {
    const res = await POST(buildRequest(validBody));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: { id: 'ptc_1' },
    });
    expect(mocks.completionUpsert).toHaveBeenCalledWith({
      where: {
        portalTaskId_memberId: { portalTaskId: 'ptsk_1', memberId: 'mem_1' },
      },
      create: {
        portalTaskId: 'ptsk_1',
        memberId: 'mem_1',
        acknowledgedText: 'I agree.',
      },
      update: {},
    });
  });

  it('completes without consulting the RBAC role', async () => {
    await POST(buildRequest(validBody));

    // The membership lookup is the whole authorization check — no role read.
    expect(mocks.memberFindFirst).toHaveBeenCalledWith({
      where: { userId: 'usr_1', organizationId: 'org_1', deactivated: false },
    });
    expect(mocks.completionUpsert).toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller', async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await POST(buildRequest(validBody));

    expect(res.status).toBe(401);
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });

  it('rejects a caller who is not an active member of the org', async () => {
    mocks.memberFindFirst.mockResolvedValue(null);

    const res = await POST(buildRequest(validBody));

    expect(res.status).toBe(403);
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });

  it('404s for a task in another organization, or one unpublished/archived', async () => {
    mocks.portalTaskFindFirst.mockResolvedValue(null);

    const res = await POST(buildRequest(validBody));

    expect(res.status).toBe(404);
    expect(mocks.portalTaskFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'ptsk_1',
        organizationId: 'org_1',
        isPublished: true,
        isArchived: false,
      },
      select: { id: true, acknowledgementText: true },
    });
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });

  it('400s on a malformed body', async () => {
    const res = await POST(buildRequest('not json'));

    expect(res.status).toBe(400);
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });

  it('400s when required fields are missing', async () => {
    const res = await POST(buildRequest({ portalTaskId: 'ptsk_1' }));

    expect(res.status).toBe(400);
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });
});
