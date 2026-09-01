const mockDb = {
  discoveredVendorCandidate: { findMany: jest.fn(), update: jest.fn() },
};

jest.mock('@db', () => ({
  db: mockDb,
  DiscoveredVendorStatus: { pending: 'pending', approved: 'approved', ignored: 'ignored' },
  VendorResolutionMethod: {
    existing_vendor: 'existing_vendor',
    global_catalogue: 'global_catalogue',
    integration_definition: 'integration_definition',
    inferred: 'inferred',
    unresolved: 'unresolved',
  },
}));

jest.mock('@ai-sdk/anthropic', () => ({ anthropic: () => 'model' }));
jest.mock('ai', () => ({ generateObject: jest.fn() }));

import { generateObject } from 'ai';
import { INFERENCE_CONFIDENCE_CEILING } from './vendor-resolution.service';
import { INFERENCE_BATCH_SIZE, VendorInferenceService } from './vendor-inference.service';

const generateObjectMock = generateObject as unknown as jest.Mock;

const suggestion = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'Acme Tool',
  recognized: true,
  vendorName: 'Acme',
  website: 'https://acme.com',
  description: 'Does things',
  category: 'collaboration_productivity',
  confidence: 0.9,
  ...overrides,
});

describe('VendorInferenceService', () => {
  let service: VendorInferenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.discoveredVendorCandidate.update.mockResolvedValue({});
    service = new VendorInferenceService();
  });

  const withCandidates = (
    candidates: Array<{ id: string; displayName: string; inferenceDisplayName?: string | null }>,
  ) => {
    mockDb.discoveredVendorCandidate.findMany.mockResolvedValue(
      candidates.map((c) => ({ inferenceDisplayName: null, ...c })),
    );
  };

  const lastUpdateData = () => {
    const calls = mockDb.discoveredVendorCandidate.update.mock.calls;
    return calls[calls.length - 1][0].data;
  };

  it('records a suggestion without deciding anything', async () => {
    withCandidates([{ id: 'dvc_1', displayName: 'Acme Tool' }]);
    generateObjectMock.mockResolvedValue({ object: { suggestions: [suggestion()] } });

    const result = await service.inferPending({ organizationId: 'org_1' });

    expect(result).toEqual({ attempted: 1, recognized: 1 });
    const data = lastUpdateData();
    expect(data.resolutionMethod).toBe('inferred');
    expect(data.resolvedName).toBe('Acme');
    // Inference never decides: the candidate's status is left alone.
    expect(data.status).toBeUndefined();
    expect(data.vendorId).toBeUndefined();
  });

  it('caps confidence at the inference ceiling', async () => {
    withCandidates([{ id: 'dvc_1', displayName: 'Acme Tool' }]);
    generateObjectMock.mockResolvedValue({
      object: { suggestions: [suggestion({ confidence: 1 })] },
    });

    await service.inferPending({ organizationId: 'org_1' });

    // An inferred result must never read as more certain than a deterministic one.
    expect(lastUpdateData().confidence).toBe(INFERENCE_CONFIDENCE_CEILING);
  });

  it('retains the raw output as evidence', async () => {
    withCandidates([{ id: 'dvc_1', displayName: 'Acme Tool' }]);
    generateObjectMock.mockResolvedValue({ object: { suggestions: [suggestion()] } });

    await service.inferPending({ organizationId: 'org_1' });

    expect(lastUpdateData().inferenceRawOutput).toMatchObject({ vendorName: 'Acme' });
  });

  it('leaves an unrecognized name unresolved but records the attempt', async () => {
    withCandidates([{ id: 'dvc_1', displayName: 'Internal Thing' }]);
    generateObjectMock.mockResolvedValue({
      object: {
        suggestions: [suggestion({ displayName: 'Internal Thing', recognized: false })],
      },
    });

    const result = await service.inferPending({ organizationId: 'org_1' });

    expect(result.recognized).toBe(0);
    const data = lastUpdateData();
    expect(data.resolutionMethod).toBeUndefined();
    // Recorded so the same unknown name is not resubmitted on every run.
    expect(data.inferenceDisplayName).toBe('Internal Thing');
  });

  it('matches suggestions by name rather than array order', async () => {
    withCandidates([
      { id: 'dvc_1', displayName: 'First' },
      { id: 'dvc_2', displayName: 'Second' },
    ]);
    generateObjectMock.mockResolvedValue({
      object: {
        suggestions: [
          suggestion({ displayName: 'Second', vendorName: 'SecondCo' }),
          suggestion({ displayName: 'First', vendorName: 'FirstCo' }),
        ],
      },
    });

    await service.inferPending({ organizationId: 'org_1' });

    const updates = mockDb.discoveredVendorCandidate.update.mock.calls.map((c) => [
      c[0].where.id,
      c[0].data.resolvedName,
    ]);
    expect(updates).toEqual([
      ['dvc_1', 'FirstCo'],
      ['dvc_2', 'SecondCo'],
    ]);
  });

  it('skips candidates whose display name has not changed since the last attempt', async () => {
    mockDb.discoveredVendorCandidate.findMany.mockResolvedValue([
      { id: 'dvc_1', displayName: 'Acme Tool', inferenceDisplayName: 'Acme Tool' },
    ]);

    const result = await service.inferPending({ organizationId: 'org_1' });

    expect(result.attempted).toBe(0);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('re-infers when the display name has changed', async () => {
    mockDb.discoveredVendorCandidate.findMany.mockResolvedValue([
      { id: 'dvc_1', displayName: 'Acme Tool v2', inferenceDisplayName: 'Acme Tool' },
    ]);
    generateObjectMock.mockResolvedValue({
      object: { suggestions: [suggestion({ displayName: 'Acme Tool v2' })] },
    });

    const result = await service.inferPending({ organizationId: 'org_1' });

    expect(result.attempted).toBe(1);
  });

  it('batches rather than calling once per candidate', async () => {
    withCandidates(
      Array.from({ length: INFERENCE_BATCH_SIZE + 1 }, (_, i) => ({
        id: `dvc_${i}`,
        displayName: `App ${i}`,
      })),
    );
    generateObjectMock.mockResolvedValue({ object: { suggestions: [] } });

    await service.inferPending({ organizationId: 'org_1' });

    expect(generateObjectMock).toHaveBeenCalledTimes(2);
  });

  it('survives a failed batch without failing the run', async () => {
    withCandidates([{ id: 'dvc_1', displayName: 'Acme Tool' }]);
    generateObjectMock.mockRejectedValue(new Error('model unavailable'));

    const result = await service.inferPending({ organizationId: 'org_1' });

    expect(result).toEqual({ attempted: 1, recognized: 0 });
    // Nothing recorded, so the candidate is retried next run.
    expect(mockDb.discoveredVendorCandidate.update).not.toHaveBeenCalled();
  });

  it('does no work when nothing needs inference', async () => {
    withCandidates([]);

    expect(await service.inferPending({ organizationId: 'org_1' })).toEqual({
      attempted: 0,
      recognized: 0,
    });
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
