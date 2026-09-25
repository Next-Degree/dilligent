import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxApiResponse, InboxData } from './inbox-data';
import { useInbox } from './use-inbox';

const mockGet = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (...args: unknown[]) => mockGet(...args) },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ orgId: 'org_1' }),
}));

const response = (taskFailed: number): { data: InboxApiResponse; status: number } => ({
  data: { data: [], count: 0, totals: { 'task-failed': taskFailed }, unavailable: [] },
  status: 200,
});

// A cache shared across hooks in one test, fresh per test, like one browser session.
function sessionWrapper() {
  const cache = new Map();
  return function SessionWrapper({ children }: { children: ReactNode }) {
    return <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>;
  };
}

describe('useInbox', () => {
  beforeEach(() => mockGet.mockReset());

  it('does not re-run the aggregation when the badge remounts on another tab', async () => {
    // The app's SWR cache outlives page navigation; only the badge remounts. One
    // SWRConfig stays mounted here for the same reason: unmounting a provider
    // discards SWR's dedupe state, which would make this test meaningless.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockGet.mockResolvedValue(response(3));
      const cache = new Map();
      const Badge = () => <span>{useInbox().totals['task-failed'] ?? '-'}</span>;
      const Session = ({ showBadge }: { showBadge: boolean }) => (
        <SWRConfig value={{ provider: () => cache }}>{showBadge && <Badge />}</SWRConfig>
      );

      const { rerender } = render(<Session showBadge />);
      await screen.findByText('3');
      rerender(<Session showBadge={false} />);

      // Past SWR's default 2s dedupe window, so only our longer window can hold.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      rerender(<Session showBadge />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(screen.getByText('3')).toBeInTheDocument();
      expect(mockGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows fresh server data over an older cached badge fetch, without refetching', async () => {
    mockGet.mockResolvedValue(response(3));
    const wrapper = sessionWrapper();

    const badge = renderHook(() => useInbox(), { wrapper });
    await waitFor(() => expect(badge.result.current.totals).toEqual({ 'task-failed': 3 }));
    badge.unmount();

    const fromServer: InboxData = { items: [], totals: { 'task-failed': 0 }, unavailable: [] };
    const page = renderHook(() => useInbox({ initialData: fromServer }), { wrapper });

    await waitFor(() => expect(page.result.current.totals).toEqual({ 'task-failed': 0 }));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('still refetches when the user asks to retry', async () => {
    mockGet.mockResolvedValueOnce(response(3)).mockResolvedValueOnce(response(1));
    const { result } = renderHook(() => useInbox(), { wrapper: sessionWrapper() });
    await waitFor(() => expect(result.current.totals).toEqual({ 'task-failed': 3 }));

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.current.totals).toEqual({ 'task-failed': 1 });
  });
});
