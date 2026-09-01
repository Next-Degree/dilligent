import { db } from '@db';
import { vendorRiskAssessmentMonthlySchedule } from './vendor-risk-assessment-monthly-schedule';
import { vendorRiskAssessmentTask } from './vendor-risk-assessment-task';

jest.mock('@db', () => ({
  db: {
    vendor: { findMany: jest.fn() },
    globalVendors: { findMany: jest.fn() },
  },
}));

jest.mock('@trigger.dev/sdk', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  schedules: {
    task: (config: unknown) => config,
  },
}));

jest.mock('./vendor-risk-assessment-task', () => ({
  vendorRiskAssessmentTask: { batchTrigger: jest.fn() },
}));

describe('vendorRiskAssessmentMonthlySchedule', () => {
  const nowMs = Date.parse('2026-09-01T02:00:00.000Z');

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    (vendorRiskAssessmentTask.batchTrigger as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  const runSchedule = () =>
    vendorRiskAssessmentMonthlySchedule.run({
      timestamp: new Date(nowMs).toISOString(),
      lastTimestamp: null,
    } as any);

  it('triggers vendors with no prior GlobalVendors record', async () => {
    (db.vendor.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'vendor_1',
        name: 'Acme',
        website: 'https://acme.com',
        organizationId: 'org_1',
      },
    ]);
    (db.globalVendors.findMany as jest.Mock).mockResolvedValue([]);

    const result = await runSchedule();

    expect(result.triggered).toBe(1);
    expect(result.skipped).toBe(0);
    expect(vendorRiskAssessmentTask.batchTrigger).toHaveBeenCalledWith([
      {
        payload: expect.objectContaining({
          vendorId: 'vendor_1',
          vendorWebsite: 'https://acme.com',
          withResearch: true,
        }),
      },
    ]);
  });

  it('skips a vendor whose GlobalVendors record was refreshed within the staleness window', async () => {
    (db.vendor.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'vendor_1',
        name: 'Acme',
        website: 'https://acme.com',
        organizationId: 'org_1',
      },
    ]);
    (db.globalVendors.findMany as jest.Mock).mockResolvedValue([
      { website: 'https://acme.com' },
    ]);

    const result = await runSchedule();

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(vendorRiskAssessmentTask.batchTrigger).not.toHaveBeenCalled();
  });

  it('refreshes a vendor whose GlobalVendors record is stale, and dedupes by domain across organizations', async () => {
    // Two orgs both have a vendor on the same domain — only one research pass
    // is needed since GlobalVendors is keyed by domain, shared across orgs.
    (db.vendor.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'vendor_org1',
        name: 'GitHub',
        website: 'https://github.com',
        organizationId: 'org_1',
      },
      {
        id: 'vendor_org2',
        name: 'GitHub',
        website: 'https://www.github.com',
        organizationId: 'org_2',
      },
    ]);
    // No GlobalVendors row matched as "fresh" — either nothing exists yet, or
    // it was last refreshed outside the staleness window.
    (db.globalVendors.findMany as jest.Mock).mockResolvedValue([]);

    const result = await runSchedule();

    expect(result.triggered).toBe(2);
    expect(result.skipped).toBe(0);

    const queryArgs = (db.globalVendors.findMany as jest.Mock).mock.calls[0][0];
    expect(queryArgs.where.riskAssessmentUpdatedAt.gte).toEqual(
      new Date(nowMs - 25 * 24 * 60 * 60 * 1000),
    );
  });

  it('keeps a vendor with no resolvable domain in the trigger list', async () => {
    (db.vendor.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'vendor_bad',
        name: 'Broken',
        website: 'not-a-valid-url',
        organizationId: 'org_1',
      },
    ]);
    (db.globalVendors.findMany as jest.Mock).mockResolvedValue([]);

    const result = await runSchedule();

    expect(result.triggered).toBe(1);
    expect(vendorRiskAssessmentTask.batchTrigger).toHaveBeenCalled();
  });

  it('returns early with no vendors found', async () => {
    (db.vendor.findMany as jest.Mock).mockResolvedValue([]);

    const result = await runSchedule();

    expect(result).toMatchObject({
      success: true,
      totalVendors: 0,
      triggered: 0,
      skipped: 0,
    });
    expect(db.globalVendors.findMany).not.toHaveBeenCalled();
    expect(vendorRiskAssessmentTask.batchTrigger).not.toHaveBeenCalled();
  });
});
