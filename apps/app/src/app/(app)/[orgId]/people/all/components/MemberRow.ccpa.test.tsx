import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MemberWithUser } from './TeamMembers';

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgId: 'org_123' }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('./MultiRoleCombobox', () => ({ MultiRoleCombobox: () => null }));
vi.mock('./RemoveDeviceAlert', () => ({ RemoveDeviceAlert: () => null }));
vi.mock('./RemoveMemberAlert', () => ({ RemoveMemberAlert: () => null }));

import { MemberRow } from './MemberRow';

const member = {
  id: 'mem_1',
  userId: 'usr_1',
  organizationId: 'org_123',
  role: 'employee',
  department: null,
  isActive: true,
  deactivated: false,
  fleetDmLabelId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: {
    id: 'usr_1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    emailVerified: true,
    image: null,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    banned: false,
    banReason: null,
    banExpires: null,
  },
} as unknown as MemberWithUser;

const noop = vi.fn();

const renderRow = (taskCompletion?: {
  completed: number;
  total: number;
  policies: { completed: number; total: number };
  training: { completed: number; total: number };
  ccpa?: { completed: number; total: number };
}) =>
  render(
    <table>
      <tbody>
        <MemberRow
          member={member}
          onRemove={noop}
          onRemoveDevice={noop}
          onUpdateRole={noop}
          onReactivate={noop}
          canEdit={false}
          isCurrentUserOwner={false}
          requirementColumns={['ccpa']}
          taskCompletion={taskCompletion}
        />
      </tbody>
    </table>,
  );

describe('MemberRow CCPA column', () => {
  it('shows progress through the two CCPA modules', () => {
    renderRow({
      completed: 1,
      total: 2,
      policies: { completed: 0, total: 0 },
      training: { completed: 0, total: 0 },
      ccpa: { completed: 1, total: 2 },
    });

    expect(screen.getByTestId('requirement-CCPA')).toHaveTextContent('1/2');
  });

  it('shows a dash when the member has no CCPA requirement', () => {
    renderRow({
      completed: 0,
      total: 0,
      policies: { completed: 0, total: 0 },
      training: { completed: 0, total: 0 },
    });

    expect(screen.queryByTestId('requirement-CCPA')).not.toBeInTheDocument();
  });

  it('shows a dash when there is no task data at all', () => {
    renderRow(undefined);

    expect(screen.queryByTestId('requirement-CCPA')).not.toBeInTheDocument();
  });
});
