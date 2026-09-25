import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.fn();
const mockTaskFindFirst = vi.fn();
const mockAutomationFindFirst = vi.fn();
const mockFetch = vi.fn();

vi.mock('@/utils/auth', () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

vi.mock('@db/server', () => ({
  db: {
    task: { findFirst: mockTaskFindFirst },
    evidenceAutomation: { findFirst: mockAutomationFindFirst },
  },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const { executeAutomationScript, uploadAutomationScript } = await import(
  './task-automation-actions'
);

const ORG_ID = 'org_abc';
const TASK_ID = 'tsk_1';
const AUTOMATION_ID = 'aut_1';

function mockSession(activeOrganizationId: string | null) {
  mockGetSession.mockResolvedValue({
    session: { activeOrganizationId },
    user: { id: 'user_1' },
  });
}

function mockEnterpriseOk(data: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data }),
  });
}

function sentBody(): unknown {
  const [, init] = mockFetch.mock.calls[0];
  return JSON.parse(init.body);
}

describe('task automation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ENTERPRISE_API_SECRET', 'secret');
    vi.stubEnv('NEXT_PUBLIC_ENTERPRISE_API_URL', 'http://enterprise.test');
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('executeAutomationScript', () => {
    const input = { orgId: ORG_ID, taskId: TASK_ID, automationId: AUTOMATION_ID, version: 2 };

    it('rejects when there is no session', async () => {
      mockGetSession.mockResolvedValue(null);

      const result = await executeAutomationScript(input);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects when orgId does not match the active organization', async () => {
      mockSession('org_other');

      const result = await executeAutomationScript(input);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects an automation that does not belong to the task and organization', async () => {
      mockSession(ORG_ID);
      mockAutomationFindFirst.mockResolvedValue(null);

      const result = await executeAutomationScript(input);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mockAutomationFindFirst).toHaveBeenCalledWith({
        where: { id: AUTOMATION_ID, taskId: TASK_ID, task: { organizationId: ORG_ID } },
        select: { id: true },
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('forwards only the known fields for an owned automation', async () => {
      mockSession(ORG_ID);
      mockAutomationFindFirst.mockResolvedValue({ id: AUTOMATION_ID });
      mockEnterpriseOk({ runId: 'run_1' });

      const result = await executeAutomationScript({
        ...input,
        ...({ key: 'org_other/secret.js' } as object),
      });

      expect(result).toEqual({ success: true, data: { runId: 'run_1' } });
      expect(sentBody()).toEqual(input);
    });
  });

  describe('uploadAutomationScript', () => {
    const input = { orgId: ORG_ID, taskId: TASK_ID, content: 'code', type: 'draft' };

    it('rejects when orgId does not match the active organization', async () => {
      mockSession('org_other');

      const result = await uploadAutomationScript(input);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a task that does not belong to the organization', async () => {
      mockSession(ORG_ID);
      mockTaskFindFirst.mockResolvedValue(null);

      const result = await uploadAutomationScript(input);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mockTaskFindFirst).toHaveBeenCalledWith({
        where: { id: TASK_ID, organizationId: ORG_ID },
        select: { id: true },
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('forwards only the known fields for an owned task', async () => {
      mockSession(ORG_ID);
      mockTaskFindFirst.mockResolvedValue({ id: TASK_ID });
      mockEnterpriseOk({ key: `${ORG_ID}/${TASK_ID}/x.js` });

      const result = await uploadAutomationScript({
        ...input,
        ...({ key: 'org_other/evil.js' } as object),
      });

      expect(result.success).toBe(true);
      expect(sentBody()).toEqual(input);
    });
  });
});
