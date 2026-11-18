import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelBatchFix: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../actions/batch-fix', () => ({
  startBatchFix: vi.fn(),
  cancelBatchFix: mocks.cancelBatchFix,
  skipBatchFinding: vi.fn(),
  retryFinding: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

// No realtime progress yet: the resumed batch counts as running.
vi.mock('@trigger.dev/react-hooks', () => ({
  useRealtimeRun: () => ({ run: undefined }),
}));

import { BatchRemediationDialog } from './BatchRemediationDialog';

function renderResumedBatch() {
  return render(
    <BatchRemediationDialog
      open
      onOpenChange={vi.fn()}
      serviceName="AWS"
      findings={[{ id: 'fnd_1', key: 's3-public', title: 'Public bucket', severity: 'high' }]}
      connectionId="conn_1"
      organizationId="org_1"
      activeBatch={{
        batchId: 'rmb_1',
        triggerRunId: 'run_1',
        accessToken: 'tok_1',
        findings: [{ id: 'fnd_1', title: 'Public bucket', status: 'fixing' }],
      }}
    />,
  );
}

describe('BatchRemediationDialog cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('cancels the resumed batch', async () => {
    mocks.cancelBatchFix.mockResolvedValue(undefined);
    renderResumedBatch();

    fireEvent.click(await screen.findByRole('button', { name: /cancel all/i }));

    await waitFor(() => expect(mocks.cancelBatchFix).toHaveBeenCalledWith('run_1', 'rmb_1'));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('re-enables Cancel All and shows an error when cancelling fails', async () => {
    mocks.cancelBatchFix.mockRejectedValue(new Error('Run is not bound to this batch'));
    renderResumedBatch();

    fireEvent.click(await screen.findByRole('button', { name: /cancel all/i }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Could not cancel the batch. Please try again.',
      ),
    );
    const button = await screen.findByRole('button', { name: /cancel all/i });
    expect(button).not.toBeDisabled();
  });
});
