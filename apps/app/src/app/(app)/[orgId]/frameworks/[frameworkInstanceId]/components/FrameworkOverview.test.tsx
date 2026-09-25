import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setMockPermissions,
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
} from '@/test-utils/mocks/permissions';

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

vi.mock('./FrameworkDeleteDialog', () => ({
  FrameworkDeleteDialog: () => <div data-testid="framework-delete-dialog" />,
}));

vi.mock('../../lib/utils', () => ({
  getControlStatus: () => 'not_started',
}));

import { FrameworkOverview } from './FrameworkOverview';

const baseProps = {
  frameworkInstanceWithControls: {
    id: 'fi_1',
    organizationId: 'org_123',
    frameworkId: 'fw_1',
    framework: {
      id: 'fw_1',
      name: 'SOC 2',
      description: 'SOC 2 Type II compliance framework',
    },
    controls: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any,
  tasks: [],
};

describe('FrameworkOverview permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows delete dropdown menu when user has framework:delete permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<FrameworkOverview {...baseProps} />);
    // The header now also renders "Link Requirement" / "Add Requirement"
    // buttons (custom-framework feature), so a bare getByRole('button') is
    // no longer unique. The dropdown trigger is the icon-only button (its
    // OverflowMenuVertical icon is aria-hidden, so it has no accessible
    // name) — filter it out from the always-present named buttons.
    const dropdownTrigger = screen.getByRole('button', { name: '' });
    expect(dropdownTrigger).toBeInTheDocument();
  });

  it('hides delete dropdown menu when user lacks framework:delete permission', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<FrameworkOverview {...baseProps} />);
    // Auditor also lacks framework:update, so Link/Add Requirement are
    // hidden too — no buttons should exist at all.
    expect(screen.queryByRole('button', { name: '' })).not.toBeInTheDocument();
  });

  it('hides delete dropdown menu when user has no permissions', () => {
    setMockPermissions({});
    render(<FrameworkOverview {...baseProps} />);
    expect(screen.queryByRole('button', { name: '' })).not.toBeInTheDocument();
  });

  it('renders framework name regardless of permissions', () => {
    setMockPermissions({});
    render(<FrameworkOverview {...baseProps} />);
    expect(screen.getByText('SOC 2')).toBeInTheDocument();
  });
});
