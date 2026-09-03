import { db } from '@db';
import type { schedules } from '@trigger.dev/sdk';
import {
  STALENESS_THRESHOLD_DAYS,
  vendorRiskAssessmentMonthlySchedule,
} from './vendor-risk-assessment-monthly-schedule';
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

// `schedules.task()` is mocked above to return its config verbatim, so `run` is
// directly callable here. The SDK's public `Task` type deliberately omits it,
// so reach it through the config type the mock actually yields — this keeps the
// payload and the result fully typechecked.
type SchedulePayload = Parameters<
  Parameters<typeof schedules.task>[0]['run']
>[0];

const schedule = vendorRiskAssessmentMonthlySchedule as unknown as {
  run: (payload: SchedulePayload) => Promise<{
    success: boolean;
    totalVendors: number;
    triggered: number;
    skipped: number;
    message?: string;
    error?: string;
  }>;
};

describe('vendorRiskAssessmentMonthlySchedule', () => {
  const nowMs = Date.parse('2026-09-01T02:00:00.000Z');

  const makeVendor = (overrides: Partial<{ id: string; website: string }>) => ({
    id: 'vendor_1',
    name: 'Acme',
    website: 'https://acme.com',
    organizationId: 'org_1',
    ...overrides,
  });

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    (vendorRiskAssessmentTask.batchTrigger as jest.Mock).mockResolvedValue(
      undefined,
    );
    // Default: nothing has been assessed recently, so nothing is skipped.
    (db.globalVendors.findMany as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  const runSchedule = () => {
    const payload: SchedulePayload = {
      type: 'DECLARATIVE',
      timestamp: new Date(nowMs),
      timezone: 'UTC',
      scheduleId: 'sched_test',
      upcoming: [],
    };
    return schedule.run(payload);
  };

  it('triggers vendors with no prior GlobalVendors record', async () => {
    (db.vendor.findMany as jest.Mock).mockResolvedValue([makeVendor({})]);

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
    (db.vendor.findMany as jest.Mock).mockResolvedValue([makeVendor({})]);
    (db.globalVendors.findMany as jest.Mock).mockResolvedValue([
      { website: 'https://acme.com' },
    ]);

    const result = await runSchedule();

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(vendorRiskAssessmentTask.batchTrigger).not.toHaveBeenCalled();
  });

  it('matches a fresh record whose stored website is formatted differently', async () => {
    // GlobalVendors rows are written by several callers in different shapes, so
    // both sides are normalized through extractDomain before comparison.
    (db.vendor.findMany as jest.Mock).mockResolvedValue([
      makeVendor({ website: 'https://www.acme.com/' }),
    ]);
    (db.globalVendors.findMany as jest.Mock).mockResolvedValue([
      { website: 'acme.com' },
    ]);

    const result = await runSchedule();

    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('queries GlobalVendors on the staleness timestamp alone', async () => {
    (db.vendor.findMany as jest.Mock).mockResolvedValue([makeVendor({})]);

    await runSchedule();

    const [queryArgs] = (db.globalVendors.findMany as jest.Mock).mock.calls[0];
    expect(queryArgs.where).toEqual({
      riskAssessmentUpdatedAt: {
        gte: new Date(nowMs - STALENESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    // A per-domain `contains` fan-out would force a full-table scan; the domain
    // match happens in memory instead.
    expect(queryArgs.where.OR).toBeUndefined();
  });

  it('refreshes both organizations when a shared vendor domain is stale', async () => {
    // GlobalVendors is keyed by domain and shared across orgs, but freshness is
    // sampled once up front — so a stale shared domain still triggers per org,
    // and the task's own dedupe is what prevents the duplicate research spend.
    (db.vendor.findMany as jest.Mock).mockResolvedValue([
      makeVendor({ id: 'vendor_org1', website: 'https://github.com' }),
      makeVendor({ id: 'vendor_org2', website: 'https://www.github.com' }),
    ]);

    const result = await runSchedule();

    expect(result.triggered).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('keeps a vendor with no resolvable domain in the trigger list', async () => {
    (db.vendor.findMany as jest.Mock).mockResolvedValue([
      makeVendor({ id: 'vendor_blank', website: '   ' }),
    ]);

    const result = await runSchedule();

    expect(result.triggered).toBe(1);
    expect(result.skipped).toBe(0);
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
