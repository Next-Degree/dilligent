import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Accordion } from '@trycompai/design-system';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// These go through real JSON, like the browser does. Dates arrive as strings;
// the hook must hand the rest of the portal real dates, or the training status
// logic throws as soon as a member has finished anything.

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('@/env.mjs', () => ({ env: { NEXT_PUBLIC_API_URL: 'http://api.test' } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ orgId: 'org_1' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.stubGlobal('fetch', mocks.fetch);

import { VideoTrainingAccordionItem } from '@/app/(app)/(home)/[orgId]/components/tasks/VideoTrainingAccordionItem';
import { trainingVideos } from '@/lib/data/training-videos';
import { useTrainingCompletions } from './use-training-completions';

const DAY_MS = 24 * 60 * 60 * 1000;

const rows = (days: number) =>
  ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'].map((videoId) => ({
    id: `evc_${videoId}`,
    memberId: 'mem_1',
    videoId,
    cycle: 1,
    dueAt: null,
    completedAt: new Date(Date.now() - days * DAY_MS),
  }));

const jsonResponse = (body: unknown) => ({
  ok: true,
  json: async () => JSON.parse(JSON.stringify(body)),
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

describe('useTrainingCompletions', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
  });

  it('hands out real dates for rows fetched from the API', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse(rows(10)));

    const { result } = renderHook(() => useTrainingCompletions(), { wrapper });

    await waitFor(() => expect(result.current.completions).toHaveLength(5));
    expect(result.current.completions[0]?.completedAt).toBeInstanceOf(Date);
  });

  it('merges the saved row as a real date when a video is marked complete', async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { ...rows(0)[0], completedAt: new Date() },
      }),
    );

    const { result } = renderHook(() => useTrainingCompletions(), { wrapper });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.markVideoComplete('sat-1');
    });

    expect(result.current.completions).toHaveLength(1);
    expect(result.current.completions[0]?.completedAt).toBeInstanceOf(Date);
  });

  it('renders a finished training without crashing once the fetch resolves', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse(rows(330)));

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Accordion>
          <VideoTrainingAccordionItem
            value="general-training"
            title="Security Awareness Training"
            description="Watch the videos."
            groupId="general"
            videos={trainingVideos}
          />
        </Accordion>
      </SWRConfig>,
    );

    expect(await screen.findByText(/Renew by/)).toBeInTheDocument();
  });
});
