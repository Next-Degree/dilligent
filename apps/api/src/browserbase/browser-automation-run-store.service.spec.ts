import { ConflictException } from '@nestjs/common';
import { db } from '@db';
import { BrowserAutomationRunStoreService } from './browser-automation-run-store.service';
import { failedBrowserEvidenceRunResult } from './browser-automation-run-result';

jest.mock('@db', () => ({
  db: {
    browserAutomationRun: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    browserAutomationStepRun: { create: jest.fn(), updateMany: jest.fn() },
  },
}));

/** The `data` finishRun asked Prisma to write. */
function writtenData() {
  return (db.browserAutomationRun.updateMany as jest.Mock).mock.calls[0][0]
    .data;
}

describe('BrowserAutomationRunStoreService finishRun', () => {
  const runs = new BrowserAutomationRunStoreService();

  beforeEach(() => {
    jest.clearAllMocks();
    (db.browserAutomationRun.updateMany as jest.Mock).mockResolvedValue({
      count: 1,
    });
  });

  // Without this the only record of an unrecognised failure was the worker's
  // log stream, so a failed run could not be diagnosed from its own row.
  it('persists the raw error alongside the classified one', async () => {
    const result = failedBrowserEvidenceRunResult(
      new Error('ECONNRESET while talking to the agent'),
    );

    await runs.finishRun({ runId: 'bar_1', startedAt: new Date(), result });

    const data = writtenData();
    // What the UI shows stays the classified summary…
    expect(data.error).toBe('Browser automation failed for an unknown reason.');
    // …while the row also carries what actually happened.
    expect(data.errorDetail).toContain('ECONNRESET while talking to the agent');
  });

  it('writes null rather than undefined when a run succeeded', async () => {
    await runs.finishRun({
      runId: 'bar_1',
      startedAt: new Date(),
      result: { success: true, status: 'completed', logs: [] },
    });

    expect(writtenData().errorDetail).toBeNull();
  });

  it('still rejects finishing a run that is no longer active', async () => {
    (db.browserAutomationRun.updateMany as jest.Mock).mockResolvedValue({
      count: 0,
    });

    await expect(
      runs.finishRun({
        runId: 'bar_1',
        startedAt: new Date(),
        result: { success: true, status: 'completed', logs: [] },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
