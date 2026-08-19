import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeLinkedAccount } from './EmployeeLinkedAccount';

const { mockPatch, mockMutate } = vi.hoisted(() => ({
  mockPatch: vi.fn(),
  mockMutate: vi.fn(),
}));

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    organizationId: 'org_1',
    patch: mockPatch,
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: mockMutate }) }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function renderLinkedAccount(
  props: Partial<React.ComponentProps<typeof EmployeeLinkedAccount>> = {},
) {
  return render(
    <EmployeeLinkedAccount
      memberId="mem_1"
      externalUserSource={null}
      externalUserId={null}
      canEdit
      {...props}
    />,
  );
}

describe('EmployeeLinkedAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatch.mockResolvedValue({ data: {}, status: 200 });
  });

  it('links a provider email and sends both halves of the pair', async () => {
    const user = userEvent.setup();
    renderLinkedAccount();

    await user.click(screen.getByRole('combobox', { name: 'Provider' }));
    await user.click(screen.getByRole('option', { name: 'GitHub' }));
    await user.type(screen.getByLabelText('Email on that provider'), 'jane.personal@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/people/mem_1', {
        externalUserSource: 'github',
        externalUserId: 'jane.personal@gmail.com',
      });
    });
  });

  it('revalidates the access list so the new match is reflected', async () => {
    const user = userEvent.setup();
    renderLinkedAccount({ externalUserSource: 'github', externalUserId: 'old@gmail.com' });

    const emailInput = screen.getByLabelText('Email on that provider');
    await user.clear(emailInput);
    await user.type(emailInput, 'new@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(['member-access', 'mem_1']);
    });
  });

  it('unlinks by clearing both fields, not just the email', async () => {
    const user = userEvent.setup();
    renderLinkedAccount({
      externalUserSource: 'github',
      externalUserId: 'jane.personal@gmail.com',
    });

    await user.click(screen.getByRole('combobox', { name: 'Provider' }));
    await user.click(screen.getByRole('option', { name: 'Not linked' }));
    await user.clear(screen.getByLabelText('Email on that provider'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/people/mem_1', {
        externalUserSource: null,
        externalUserId: null,
      });
    });
  });

  it('rejects an email with no provider instead of sending a half-set pair', async () => {
    const user = userEvent.setup();
    renderLinkedAccount();

    await user.type(screen.getByLabelText('Email on that provider'), 'jane.personal@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Choose the provider this email belongs to.')).toBeVisible();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('rejects a provider with no email', async () => {
    const user = userEvent.setup();
    renderLinkedAccount();

    await user.click(screen.getByRole('combobox', { name: 'Provider' }));
    await user.click(screen.getByRole('option', { name: 'GitHub' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter the email used on this provider.')).toBeVisible();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    const user = userEvent.setup();
    renderLinkedAccount();

    await user.click(screen.getByRole('combobox', { name: 'Provider' }));
    await user.click(screen.getByRole('option', { name: 'GitHub' }));
    await user.type(screen.getByLabelText('Email on that provider'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeVisible();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  // Linking an email widens what counts as this member's access, so a
  // read-only user must not be able to change it.
  it('disables every control for a read-only user', () => {
    renderLinkedAccount({
      canEdit: false,
      externalUserSource: 'github',
      externalUserId: 'jane.personal@gmail.com',
    });

    expect(screen.getByLabelText('Email on that provider')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Provider' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the currently linked account', () => {
    renderLinkedAccount({
      externalUserSource: 'github',
      externalUserId: 'jane.personal@gmail.com',
    });

    expect(screen.getByLabelText('Email on that provider')).toHaveValue('jane.personal@gmail.com');
    expect(screen.getByRole('combobox', { name: 'Provider' })).toHaveTextContent('GitHub');
  });
});
