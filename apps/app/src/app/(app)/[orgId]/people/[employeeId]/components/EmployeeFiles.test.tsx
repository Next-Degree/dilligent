import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeFiles } from './EmployeeFiles';

const { mockPatch, mockRefresh } = vi.hoisted(() => ({
  mockPatch: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({ organizationId: 'org_1', patch: mockPatch }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const FOLDER = 'https://drive.google.com/drive/folders/1AbC';

function renderFiles(props: Partial<React.ComponentProps<typeof EmployeeFiles>> = {}) {
  return render(<EmployeeFiles memberId="mem_1" driveFolderUrl={null} canEdit {...props} />);
}

describe('EmployeeFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatch.mockResolvedValue({ data: {}, status: 200 });
  });

  it('saves a Drive folder link', async () => {
    const user = userEvent.setup();
    renderFiles();

    await user.type(screen.getByLabelText('Google Drive folder link'), FOLDER);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/people/mem_1', { driveFolderUrl: FOLDER });
    });
  });

  it('rejects links that are not Google Drive', async () => {
    const user = userEvent.setup();
    renderFiles();

    await user.type(screen.getByLabelText('Google Drive folder link'), 'https://evil.example/x');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a valid https://drive.google.com link.')).toBeTruthy();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('clears the link by sending null', async () => {
    const user = userEvent.setup();
    renderFiles({ driveFolderUrl: FOLDER });

    await user.clear(screen.getByLabelText('Google Drive folder link'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/people/mem_1', { driveFolderUrl: null });
    });
  });

  it('shows an open link and no save button to read-only users', () => {
    renderFiles({ driveFolderUrl: FOLDER, canEdit: false });

    expect(screen.getByRole('link', { name: 'Open folder in Google Drive' }).getAttribute('href')).toBe(FOLDER);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect((screen.getByLabelText('Google Drive folder link') as HTMLInputElement).disabled).toBe(true);
  });
});
