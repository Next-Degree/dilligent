import { buildTrainingGroupView } from '@/lib/training/training-view';
import type { Member, Organization, User } from '@db';
import { getTrainingGroup } from '@trycompai/company';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  raw: vi.fn(),
  downloadPdfBlob: vi.fn(),
  toastError: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ apiClient: { raw: mocks.raw } }));
vi.mock('./downloadBase64Pdf', () => ({ downloadPdfBlob: mocks.downloadPdfBlob }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission }),
}));

import { EmployeeCcpaTraining } from './EmployeeCcpaTraining';

const DAY_MS = 24 * 60 * 60 * 1000;

const employee = {
  id: 'mem_1',
  user: { name: 'Jane Doe', email: 'jane@example.com' },
} as unknown as Member & { user: User };

const organization = { id: 'org_1', securityTrainingStepEnabled: false } as unknown as Organization;

const ccpaView = (videoIds: string[]) =>
  buildTrainingGroupView({
    group: getTrainingGroup('ccpa'),
    completions: videoIds.map((videoId) => ({
      videoId,
      cycle: 1,
      completedAt: new Date(Date.now() - 2 * DAY_MS),
    })),
    now: new Date(),
  });

const renderCcpa = (videoIds: string[]) =>
  render(
    <EmployeeCcpaTraining
      employee={employee}
      organization={organization}
      view={ccpaView(videoIds)}
    />,
  );

describe('EmployeeCcpaTraining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockReturnValue(true);
  });

  it('lists the two CCPA videos by title and what is finished', () => {
    renderCcpa(['ccpa-1']);

    expect(screen.getByText('1/2 Videos Completed')).toBeInTheDocument();
    expect(screen.getByText('CCPA Privacy Training - Part 1')).toBeInTheDocument();
    expect(screen.getByText('CCPA Privacy Training - Part 2')).toBeInTheDocument();
  });

  it('never shows the managed-outside notice, which only concerns general training', () => {
    renderCcpa([]);

    expect(screen.queryByText(/managed outside of Dilligent/)).not.toBeInTheDocument();
    expect(screen.getByText('0/2 Videos Completed')).toBeInTheDocument();
  });

  it('offers no certificate until both videos are done', () => {
    renderCcpa(['ccpa-1']);

    expect(screen.queryByRole('button', { name: /certificate/i })).not.toBeInTheDocument();
  });

  it('downloads the CCPA certificate from the API once the training is done', async () => {
    const pdf = new Blob(['%PDF-ccpa'], { type: 'application/pdf' });
    mocks.raw.mockResolvedValue({ ok: true, blob: async () => pdf });

    renderCcpa(['ccpa-1', 'ccpa-2']);
    fireEvent.click(screen.getByRole('button', { name: /certificate/i }));

    await waitFor(() => expect(mocks.downloadPdfBlob).toHaveBeenCalled());
    expect(mocks.raw).toHaveBeenCalledWith('/v1/training/generate-ccpa-certificate', {
      method: 'POST',
      organizationId: 'org_1',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: 'mem_1' }),
    });
    expect(mocks.downloadPdfBlob).toHaveBeenCalledWith({
      blob: pdf,
      fileName: 'ccpa-training-certificate-jane-doe.pdf',
    });
  });

  it('tells the admin when the certificate could not be generated', async () => {
    mocks.raw.mockResolvedValue({ ok: false, blob: async () => new Blob() });

    renderCcpa(['ccpa-1', 'ccpa-2']);
    fireEvent.click(screen.getByRole('button', { name: /certificate/i }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.downloadPdfBlob).not.toHaveBeenCalled();
  });

  it('tells the admin when the download fails on the network', async () => {
    mocks.raw.mockRejectedValue(new TypeError('Failed to fetch'));

    renderCcpa(['ccpa-1', 'ccpa-2']);
    fireEvent.click(screen.getByRole('button', { name: /certificate/i }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.downloadPdfBlob).not.toHaveBeenCalled();
  });

  it('hides the certificate from someone without permission to read training records', () => {
    mocks.hasPermission.mockReturnValue(false);

    renderCcpa(['ccpa-1', 'ccpa-2']);

    expect(mocks.hasPermission).toHaveBeenCalledWith('training', 'read');
    expect(screen.queryByRole('button', { name: /certificate/i })).not.toBeInTheDocument();
    expect(screen.getByText('All Training Complete')).toBeInTheDocument();
  });
});
