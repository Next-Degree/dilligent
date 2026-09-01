import { Departments } from '@db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbMock,
  upsertMock,
  findSimilarTasksMock,
  waitForIndexedMock,
  pruneMock,
  rerankMock,
} = vi.hoisted(() => ({
  dbMock: {
    risk: { findMany: vi.fn(), update: vi.fn() },
    vendor: { findMany: vi.fn(), update: vi.fn() },
    task: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
  upsertMock: vi.fn(),
  findSimilarTasksMock: vi.fn(),
  waitForIndexedMock: vi.fn(),
  pruneMock: vi.fn(),
  rerankMock: vi.fn(),
}));

vi.mock('@db/server', () => ({ db: dbMock }));

vi.mock('@/lib/embedding', () => ({
  upsertEntityEmbeddings: upsertMock,
  findSimilarTasks: findSimilarTasksMock,
  waitForIndexed: waitForIndexedMock,
  pruneOrphanTaskVectors: pruneMock,
}));

vi.mock('@/lib/rerank-suggestions', () => ({
  rerankSuggestions: rerankMock,
}));

vi.mock('@trigger.dev/sdk', () => ({
  task: (def: { run: Function }) => ({ run: def.run }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metadata: { set: vi.fn() },
}));

import { linkRisksAndVendorsToWork } from './link-risks-and-vendors-to-work';

const runTask = (linkRisksAndVendorsToWork as unknown as {
  run: (payload: { organizationId: string; riskId?: string; vendorId?: string }) => Promise<unknown>;
}).run;

beforeEach(() => {
  upsertMock.mockReset();
  findSimilarTasksMock.mockReset();
  waitForIndexedMock.mockReset();
  // Index already drained — runLinkage proceeds straight to matching.
  waitForIndexedMock.mockResolvedValue({ waitedMs: 0, polls: 1 });
  pruneMock.mockReset();
  pruneMock.mockResolvedValue({ deletedSourceIds: [], scanned: 0 });
  // Every entity embeds as if for the first time; runLinkage writes the
  // returned hashes back before matching.
  upsertMock.mockImplementation(async ({ entities }: { entities: Array<{ id: string }> }) => ({
    appliedHashes: entities.map((e) => ({ id: e.id, hash: `hash_${e.id}` })),
    skippedCount: 0,
  }));
  rerankMock.mockReset();
  // Pass-through reranker: scale cosine 0-1 → 0-10 so ordering stays the
  // cosine ordering and these tests stay about linkage, not about reranking.
  rerankMock.mockImplementation(
    async ({ candidates }: { candidates: Array<{ id: string; cosineScore: number }> }) =>
      candidates.map((c) => ({ ...c, rerankScore: c.cosineScore * 10 })),
  );
  Object.values(dbMock).forEach((m) =>
    Object.values(m as Record<string, ReturnType<typeof vi.fn>>).forEach((fn) => fn.mockReset()),
  );
});

describe('linkRisksAndVendorsToWork', () => {
  it('links each risk to top-K matching tasks (above threshold)', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([
      {
        id: 'rsk_1',
        title: 'Phishing',
        description: 'Email phishing',
        category: 'people',
        department: Departments.hr,
      },
    ]);
    dbMock.vendor.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([
      { id: 'tsk_a', title: 'Awareness training', description: '', department: Departments.hr },
      { id: 'tsk_b', title: 'Backup', description: '', department: Departments.it },
    ]);
    findSimilarTasksMock.mockResolvedValueOnce([
      { id: 'tsk_a', score: 0.8, department: Departments.hr },
      { id: 'tsk_b', score: 0.5, department: Departments.it },
    ]);

    await runTask({ organizationId: 'org_1' });

    expect(dbMock.risk.update).toHaveBeenCalledWith({
      where: { id: 'rsk_1' },
      data: { tasks: { connect: [{ id: 'tsk_a' }] } },
    });
  });

  it('skips a risk with no candidates above threshold', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([
      { id: 'rsk_1', title: 't', description: 'd', category: 'people', department: Departments.hr },
    ]);
    dbMock.vendor.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([
      { id: 'tsk_a', title: 'irrelevant', description: '', department: Departments.it },
    ]);
    findSimilarTasksMock.mockResolvedValueOnce([
      { id: 'tsk_a', score: 0.3, department: Departments.it },
    ]);

    await runTask({ organizationId: 'org_1' });

    expect(dbMock.risk.update).not.toHaveBeenCalled();
  });

  it('returns early when org has no tasks', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([
      { id: 'rsk_1', title: 't', description: 'd', category: 'people', department: Departments.hr },
    ]);
    dbMock.vendor.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([]);

    await runTask({ organizationId: 'org_1' });

    expect(findSimilarTasksMock).not.toHaveBeenCalled();
    expect(dbMock.risk.update).not.toHaveBeenCalled();
  });

  it('scopes to a single risk when riskId is provided', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([
      { id: 'rsk_1', title: 'a', description: '', category: 'people', department: Departments.hr },
    ]);
    dbMock.vendor.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([
      { id: 'tsk_a', title: 'awareness', description: '', department: Departments.hr },
    ]);
    findSimilarTasksMock.mockResolvedValueOnce([
      { id: 'tsk_a', score: 0.9, department: Departments.hr },
    ]);

    await runTask({ organizationId: 'org_1', riskId: 'rsk_1' });

    expect(dbMock.risk.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', id: 'rsk_1' },
      select: expect.any(Object),
    });
  });

  it('links vendors via _TaskToVendor when vendorId is provided', async () => {
    dbMock.risk.findMany.mockResolvedValueOnce([]);
    dbMock.vendor.findMany.mockResolvedValueOnce([
      {
        id: 'vnd_1',
        name: 'AcmeCRM',
        description: 'cloud crm',
        // Function and delivery are separate dimensions now: a hosted CRM is
        // `sales` + [`saas`], never the retired `software_as_a_service`.
        category: 'sales',
        deliveryModels: ['saas'],
        dataServiceTypes: [],
        dataFlowRoles: ['destination'],
      },
    ]);
    dbMock.task.findMany.mockResolvedValueOnce([
      { id: 'tsk_a', title: 'vendor review', description: '', department: Departments.gov },
    ]);
    findSimilarTasksMock.mockResolvedValueOnce([
      { id: 'tsk_a', score: 0.85, department: Departments.gov },
    ]);

    await runTask({ organizationId: 'org_1', vendorId: 'vnd_1' });

    expect(dbMock.vendor.update).toHaveBeenCalledWith({
      where: { id: 'vnd_1' },
      data: { tasks: { connect: [{ id: 'tsk_a' }] } },
    });
  });
});
