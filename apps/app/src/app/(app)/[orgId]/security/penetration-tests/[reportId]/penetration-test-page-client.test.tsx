import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PentestRun } from '@/lib/security/penetration-tests-client';
import { PenetrationTestPageClient } from './penetration-test-page-client';

// `PenetrationTestPageClient` is now a thin wrapper around the shared
// `SplitView` shell (see `../_components/SplitView.tsx`) used by both the
// list and detail routes. With `reportId` set, SplitView always renders the
// run-list sidebar + `DetailPane` (never the overview/create panels), so
// these tests drive it the same way SplitView itself does: through the
// `../hooks/use-penetration-tests` hooks.
const usePenetrationTestMock = vi.fn();
const usePenetrationTestsMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      status: 200,
      data: { subscriptions: [] },
    }),
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../hooks/use-penetration-tests', () => ({
  usePenetrationTest: (...args: never[]) => usePenetrationTestMock(...args),
  usePenetrationTests: (...args: never[]) => usePenetrationTestsMock(...args),
  usePenetrationTestIssues: () => ({ issues: [], isLoading: false, error: undefined }),
  usePenetrationTestEvents: () => ({ events: [], isLoading: false }),
  useCreatePenetrationTest: () => ({
    createReport: vi.fn(),
    isCreating: false,
    error: null,
    resetError: vi.fn(),
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}));

const reportMock = usePenetrationTestMock as ReturnType<typeof vi.fn>;
const reportsMock = usePenetrationTestsMock as ReturnType<typeof vi.fn>;

const baseReport = {
  id: 'run_1',
  targetUrl: 'https://example.com',
  repoUrl: 'https://github.com/org/repo',
  createdAt: '2026-02-26T18:00:00Z',
  updatedAt: '2026-02-26T18:30:00Z',
  error: null,
  temporalUiUrl: null,
  webhookUrl: null,
} satisfies Partial<PentestRun>;

describe('PenetrationTestPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsMock.mockReturnValue({
      reports: [],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
      activeReports: [],
      completedReports: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a loading indicator before the report is available', () => {
    reportMock.mockReturnValue({
      report: undefined,
      isLoading: true,
      error: undefined,
      mutate: vi.fn(),
    });

    const { container } = render(<PenetrationTestPageClient orgId="org_123" reportId="run_1" />);

    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows an error state when report loading fails', () => {
    reportMock.mockReturnValue({
      report: undefined,
      isLoading: false,
      error: new Error('Not found'),
      mutate: vi.fn(),
    });

    render(<PenetrationTestPageClient orgId="org_123" reportId="run_1" />);

    expect(screen.getByText('Unable to load scan')).toBeInTheDocument();
    expect(screen.getByText('Not found')).toBeInTheDocument();
  });

  it('falls back to a generic message when report error is not an Error instance', () => {
    reportMock.mockReturnValue({
      report: undefined,
      isLoading: false,
      error: 'fatal payload fetch error' as never,
      mutate: vi.fn(),
    });

    render(<PenetrationTestPageClient orgId="org_123" reportId="run_1" />);

    expect(screen.getByText('Unable to load scan')).toBeInTheDocument();
    expect(screen.getByText('No scan found for this organization.')).toBeInTheDocument();
  });

  it('renders completed (clean) report details and download actions', () => {
    // `usePenetrationTestIssues` is mocked to always return `issues: []`
    // above, so a `completed` run always hits `CompletedDetail`'s
    // "clean" (zero-findings) branch — the audit-attestation
    // `CleanReportLayout`, not a findings table.
    const report: PentestRun = {
      ...baseReport,
      status: 'completed',
    };

    reportMock.mockReturnValue({
      report,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });

    render(<PenetrationTestPageClient orgId="org_123" reportId="run_1" />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
    // "https://example.com" also appears a second time inside the clean-run
    // hero copy ("No findings reported...<target>"), so scope to the page
    // heading rather than a bare text match.
    expect(screen.getByRole('heading', { name: 'https://example.com' })).toBeInTheDocument();
    expect(screen.getByText(/Repo: https:\/\/github\.com\/org\/repo/)).toBeInTheDocument();
    expect(screen.getByText('No findings reported in this scan')).toBeInTheDocument();
    expect(screen.getByText('Markdown')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  it('shows no repo metadata when repoUrl is missing', () => {
    // The dedicated "Repository" label + "—" placeholder is gone — repo
    // info is now an optional inline metadata chip that's simply omitted
    // when there's no repoUrl (see CompletedDetail.tsx).
    const report: PentestRun = {
      ...baseReport,
      id: 'run_6',
      repoUrl: null,
      status: 'completed',
      updatedAt: '2026-02-25T18:30:00Z',
    };

    reportMock.mockReturnValue({
      report,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });

    render(<PenetrationTestPageClient orgId="org_123" reportId="run_6" />);

    expect(screen.getByRole('heading', { name: 'https://example.com' })).toBeInTheDocument();
    expect(screen.queryByText(/^Repo:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Repository')).not.toBeInTheDocument();
  });

  it('renders the running progress section when a live report is available', () => {
    const report: PentestRun = {
      ...baseReport,
      id: 'run_2',
      status: 'running',
      progress: { completedAgents: 1, totalAgents: 2, elapsedMs: 300 },
    };

    // Elapsed time is computed client-side from `createdAt` vs. `Date.now()`
    // (not trusted from `progress.elapsedMs`), so pin the clock to the
    // run's `createdAt` for a deterministic "0m elapsed".
    vi.useFakeTimers();
    vi.setSystemTime(new Date(report.createdAt));

    reportMock.mockReturnValue({
      report,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });

    render(<PenetrationTestPageClient orgId="org_123" reportId="run_2" />);

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByLabelText('Agents: 1 of 2 complete')).toBeInTheDocument();
    expect(screen.getByText(/Running · 0m elapsed/)).toBeInTheDocument();
    expect(screen.queryByText('PDF')).toBeNull();
    expect(screen.queryByText('Markdown')).toBeNull();
  });

  it('defaults the agent grid to 22 total agents when the run has no progress data', () => {
    const report: PentestRun = {
      ...baseReport,
      id: 'run_4',
      status: 'running',
      progress: undefined,
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date(report.createdAt));

    reportMock.mockReturnValue({
      report,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });

    render(<PenetrationTestPageClient orgId="org_123" reportId="run_4" />);

    expect(screen.getByLabelText('Agents: 0 of 22 complete')).toBeInTheDocument();
  });

  it('renders the failure reason for a failed report', () => {
    const report: PentestRun = {
      ...baseReport,
      id: 'run_3',
      status: 'failed',
      error: 'Scan failed due to provider timeout',
      temporalUiUrl: 'https://temporal.ui/session',
    };

    reportMock.mockReturnValue({
      report,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });

    render(<PenetrationTestPageClient orgId="org_123" reportId="run_3" />);

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Run error')).toBeInTheDocument();
    expect(screen.getByText('Scan failed due to provider timeout')).toBeInTheDocument();
    // The "Open temporal UI" debug link was removed in the split-view
    // rewrite — `temporalUiUrl` is still on the type, but FailedDetail no
    // longer reads it.
    expect(screen.queryByText('Open temporal UI')).toBeNull();
  });
});
