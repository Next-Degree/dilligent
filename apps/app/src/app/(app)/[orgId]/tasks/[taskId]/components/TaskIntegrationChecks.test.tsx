import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredCheckRun, TaskIntegrationCheck } from '../hooks/useIntegrationChecks';

// Two providers whose checks happen to share the same `checkId` — the exact
// shape that caused "running one runs them all": before Neon/Vercel/Trigger.dev's
// App Availability checks were given unique ids, the frontend keyed local
// state (running/expanded spinners) and grouped run history by checkId alone,
// so one provider's row visually reacted to (and displayed evidence for)
// another provider's run.
const CHECK_A: TaskIntegrationCheck = {
  integrationId: 'neon',
  integrationName: 'Neon',
  integrationLogoUrl: '/neon.png',
  checkId: 'shared-check-id',
  checkName: 'App Availability',
  checkDescription: 'Verify the app is available',
  isConnected: true,
  isDisabledForTask: false,
  needsConfiguration: false,
  connectionId: 'conn_neon',
  connectionStatus: 'active',
  authType: 'api_key',
};

const CHECK_B: TaskIntegrationCheck = {
  ...CHECK_A,
  integrationId: 'vercel',
  integrationName: 'Vercel',
  integrationLogoUrl: '/vercel.png',
  connectionId: 'conn_vercel',
};

function buildRun(overrides: Partial<StoredCheckRun>): StoredCheckRun {
  const now = new Date().toISOString();
  return {
    id: `run_${overrides.connectionId}`,
    checkId: 'shared-check-id',
    checkName: 'App Availability',
    status: 'success',
    startedAt: now,
    completedAt: now,
    durationMs: 10,
    totalChecked: 1,
    passedCount: 1,
    failedCount: 0,
    connectionId: 'conn_neon',
    connectionLabel: 'Account',
    provider: { slug: 'neon', name: 'Neon' },
    results: [],
    createdAt: now,
    ...overrides,
  };
}

const runCheckMock = vi.fn();
let resolveRunCheck: (() => void) | undefined;

vi.mock('../hooks/useIntegrationChecks', () => ({
  useIntegrationChecks: () => ({
    checks: [CHECK_A, CHECK_B],
    runs: [
      buildRun({ connectionId: 'conn_neon', provider: { slug: 'neon', name: 'Neon' }, passedCount: 1, failedCount: 0, status: 'success' }),
      buildRun({ connectionId: 'conn_vercel', provider: { slug: 'vercel', name: 'Vercel' }, passedCount: 0, failedCount: 1, status: 'failed' }),
    ],
    lastAttempts: [],
    isLoading: false,
    error: null,
    mutateChecks: vi.fn(),
    mutateRuns: vi.fn(),
    runCheck: runCheckMock,
    revokeException: vi.fn(),
    disconnectCheckFromTask: vi.fn(),
    reconnectCheckToTask: vi.fn(),
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgId: 'org_1' }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));

vi.mock('@/utils/auth-client', () => ({
  useActiveOrganization: () => ({ data: { name: 'Acme' } }),
}));

vi.mock('@/lib/evidence-download', () => ({
  downloadAutomationPDF: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/integrations/ConnectIntegrationDialog', () => ({
  ConnectIntegrationDialog: () => null,
}));
vi.mock('@/components/integrations/ManageIntegrationDialog', () => ({
  ManageIntegrationDialog: () => null,
}));
vi.mock('@/components/integrations/MarkExceptionModal', () => ({
  MarkExceptionModal: () => null,
}));
vi.mock('@/components/schedule-picker', () => ({
  SchedulePicker: () => null,
}));

// Run history rendering isn't under test here — this suite only checks that
// each row is fed the RIGHT slice of run history, not how that slice renders.
vi.mock('./check-run-history', () => ({
  AccountRunGroups: () => <div data-testid="account-run-groups" />,
}));

vi.mock('@trycompai/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('@trycompai/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    title,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: (e: React.MouseEvent) => void;
    title?: string;
  }) => (
    <button type="button" disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('@trycompai/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  AlertCircle: () => <span />,
  AlertTriangle: () => <span />,
  ArrowRight: () => <span />,
  Bot: () => <span />,
  CheckCircle2: () => <span />,
  ChevronDown: () => <span />,
  Download: () => <span />,
  ExternalLink: () => <span />,
  Loader2: () => <span data-testid="loader-icon" />,
  Play: () => <span data-testid="play-icon" />,
  Plug: () => <span />,
  PlugZap: () => <span />,
  Settings2: () => <span />,
  TrendingUp: () => <span />,
  Unplug: () => <span />,
  XCircle: () => <span />,
}));

import { TaskIntegrationChecks } from './TaskIntegrationChecks';

describe('TaskIntegrationChecks — checks that share a checkId across integrations', () => {
  beforeEach(() => {
    runCheckMock.mockReset();
    runCheckMock.mockImplementation(
      () =>
        new Promise<{ taskStatus: null }>((resolve) => {
          resolveRunCheck = () => resolve({ taskStatus: null });
        }),
    );
  });

  it('only spins the row that was actually run, not every row sharing its checkId', async () => {
    render(<TaskIntegrationChecks taskId="task_1" />);

    const runButtons = screen.getAllByText('Run').map((el) => el.closest('button')!);
    expect(runButtons).toHaveLength(2);

    fireEvent.click(runButtons[0]);

    // Neon's run is in flight; Vercel's row must stay idle.
    await waitFor(() => {
      expect(screen.getAllByTestId('loader-icon')).toHaveLength(1);
    });
    expect(screen.getAllByTestId('play-icon')).toHaveLength(1);

    resolveRunCheck?.();
    await waitFor(() => {
      expect(screen.queryAllByTestId('loader-icon')).toHaveLength(0);
    });
  });

  it("keeps each provider's run history scoped to its own connection", () => {
    render(<TaskIntegrationChecks taskId="task_1" />);

    const neonRow = within(screen.getByText('Neon').closest('div.rounded-lg')!);
    const vercelRow = within(screen.getByText('Vercel').closest('div.rounded-lg')!);

    // Neon's run passed with no failures; Vercel's run failed. Grouping by
    // checkId alone (ignoring the integration) would merge both runs onto
    // both rows, so each would wrongly show 1 passed + 1 issue instead of
    // just its own outcome.
    expect(neonRow.getByText(/1 passed/)).toBeInTheDocument();
    expect(neonRow.queryByText(/issues/)).not.toBeInTheDocument();
    expect(vercelRow.getByText(/0 passed/)).toBeInTheDocument();
    expect(vercelRow.getByText(/1 issues/)).toBeInTheDocument();

    // Neither row pulled in the other provider's account.
    expect(neonRow.queryByText(/accounts/)).not.toBeInTheDocument();
    expect(vercelRow.queryByText(/accounts/)).not.toBeInTheDocument();
  });
});
