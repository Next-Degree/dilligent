import type { InboxData, InboxItem } from '@/hooks/inbox-data';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxList } from './InboxList';

const mockRefresh = vi.fn();
let mockState: {
  items: InboxItem[];
  totals: InboxData['totals'];
  hasData: boolean;
  isLoading: boolean;
  error: Error | undefined;
};

vi.mock('@/hooks/use-inbox', () => ({
  useInbox: () => ({ ...mockState, refresh: mockRefresh }),
}));

const NOW = new Date('2026-09-24T12:00:00.000Z');

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  key: 'v1:task-failed:tsk_1',
  kind: 'task-failed',
  severity: 'critical',
  title: 'Enforce MFA on all admin accounts',
  detail: '3 failing results in its most recent failed check',
  path: 'tasks/tsk_1',
  occurredAt: '2026-09-24T10:00:00.000Z',
  assigneeMemberId: null,
  ...overrides,
});

function setState(overrides: Partial<typeof mockState>) {
  mockState = {
    items: [],
    totals: {},
    hasData: true,
    isLoading: false,
    error: undefined,
    ...overrides,
  };
}

function renderList() {
  return render(<InboxList orgId="org_1" />);
}

describe('InboxList', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mockRefresh.mockClear();
    setState({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('states', () => {
    it('shows a skeleton while the first load is in flight', () => {
      setState({ hasData: false, isLoading: true });

      renderList();

      expect(screen.getByLabelText('Loading inbox')).toHaveAttribute('aria-busy', 'true');
    });

    it('offers a retry when the first load fails', async () => {
      setState({ hasData: false, error: new Error('boom') });
      const user = userEvent.setup();

      renderList();
      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(screen.getByText("Couldn't load your inbox")).toBeInTheDocument();
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it('keeps showing items when a background refresh fails', () => {
      setState({ items: [item()], totals: { 'task-failed': 1 }, error: new Error('boom') });

      renderList();

      expect(screen.getByText('Enforce MFA on all admin accounts')).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load your inbox")).not.toBeInTheDocument();
    });

    it('shows the all-clear state when every visible source is empty', () => {
      setState({ totals: { 'task-failed': 0, 'connection-error': 0 } });

      renderList();

      expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    });
  });

  describe('role visibility', () => {
    it('explains an empty inbox when the role can read none of the sources', () => {
      setState({ totals: {} });

      renderList();

      expect(screen.getByText('Nothing to show for your role')).toBeInTheDocument();
      expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    });

    it('summarizes only the sources the role can read', () => {
      setState({ items: [item()], totals: { 'task-failed': 1 } });

      renderList();

      expect(screen.getByText('1 failing task')).toBeInTheDocument();
      expect(screen.queryByText(/regression/)).not.toBeInTheDocument();
      expect(screen.queryByText(/integration/)).not.toBeInTheDocument();
    });
  });

  describe('items', () => {
    it('links each row to the page that owns it', () => {
      setState({
        items: [
          item(),
          item({
            key: 'v1:connection-error:icn_1',
            kind: 'connection-error',
            title: 'GitHub connection is failing',
            detail: 'OAuth token was revoked',
            path: 'integrations/github',
          }),
        ],
        totals: { 'task-failed': 1, 'connection-error': 1 },
      });

      renderList();

      expect(
        screen.getByRole('link', { name: /Enforce MFA on all admin accounts/ }),
      ).toHaveAttribute('href', '/org_1/tasks/tsk_1');
      expect(screen.getByRole('link', { name: /GitHub connection is failing/ })).toHaveAttribute(
        'href',
        '/org_1/integrations/github',
      );
    });

    it('shows detail, kind, relative time, and an accessible severity label', () => {
      setState({ items: [item()], totals: { 'task-failed': 1 } });

      renderList();
      const row = screen.getByRole('link', { name: /Enforce MFA/ });

      expect(
        within(row).getByText('3 failing results in its most recent failed check'),
      ).toBeInTheDocument();
      expect(within(row).getByText('Critical:')).toHaveClass('sr-only');
      expect(within(row).getAllByText('Failing task').length).toBeGreaterThan(0);
      const times = within(row).getAllByText('about 2 hours ago');
      expect(times[0].closest('time')).toHaveAttribute('dateTime', '2026-09-24T10:00:00.000Z');
    });

    it('moves row metadata under the text on phones and beside it from sm up', () => {
      setState({ items: [item()], totals: { 'task-failed': 1 } });

      renderList();
      const row = screen.getByRole('link', { name: /Enforce MFA/ });
      const [mobileTime, desktopTime] = within(row).getAllByText('about 2 hours ago');

      expect(mobileTime.closest('.sm\\:hidden')).not.toBeNull();
      expect(desktopTime.closest('.hidden.sm\\:flex')).not.toBeNull();
    });

    it('omits the time rather than crashing on an unparseable timestamp', () => {
      setState({ items: [item({ occurredAt: 'not-a-date' })], totals: { 'task-failed': 1 } });

      renderList();

      expect(screen.getByText('Enforce MFA on all admin accounts')).toBeInTheDocument();
      expect(document.querySelector('time')).toBeNull();
    });
  });

  describe('summary and truncation', () => {
    it('summarizes true totals and skips kinds with nothing in them', () => {
      setState({
        items: [item()],
        totals: { 'task-failed': 3, 'finding-regression': 0, 'connection-error': 1 },
      });

      renderList();

      expect(screen.getByText('3 failing tasks · 1 broken integration')).toBeInTheDocument();
    });

    it('says when a source has more than is shown, with a link to the full list', () => {
      setState({
        items: [item()],
        totals: { 'task-failed': 3 },
      });

      renderList();

      expect(screen.getByText('Showing 1 of 3 failing tasks.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute(
        'href',
        '/org_1/tasks?status=failed',
      );
    });

    it('adds no truncation note when everything is shown', () => {
      setState({ items: [item()], totals: { 'task-failed': 1 } });

      renderList();

      expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'View all' })).not.toBeInTheDocument();
    });
  });
});
