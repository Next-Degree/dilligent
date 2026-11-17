import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CompletionRow {
  id: string;
  memberId: string;
  videoId: string;
  cycle: number;
  dueAt: Date | null;
  completedAt: Date | null;
}

const mocks = vi.hoisted(() => ({
  completions: [] as CompletionRow[],
  markVideoComplete: vi.fn(),
}));

vi.mock('@/hooks/use-training-completions', () => ({
  useTrainingCompletions: () => ({
    completions: mocks.completions,
    markVideoComplete: mocks.markVideoComplete,
  }),
}));

import { ccpaTrainingVideos, trainingVideos } from '@/lib/data/training-videos';
import { VideoCarousel } from './VideoCarousel';

const DAY_MS = 24 * 60 * 60 * 1000;
const GENERAL = trainingVideos.map((video) => video.id);

const rows = ({
  videoIds,
  cycle = 1,
  days,
}: {
  videoIds: string[];
  cycle?: number;
  days: number;
}): CompletionRow[] =>
  videoIds.map((videoId) => ({
    id: `evc_${videoId}_${cycle}`,
    memberId: 'mem_1',
    videoId,
    cycle,
    dueAt: null,
    completedAt: new Date(Date.now() - days * DAY_MS),
  }));

const renderGeneral = () => render(<VideoCarousel groupId="general" videos={trainingVideos} />);

describe('VideoCarousel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completions = [];
    mocks.markVideoComplete.mockResolvedValue(undefined);
  });

  it('starts a new member on the first video and records it when marked complete', () => {
    renderGeneral();

    expect(screen.getByTitle('Security Awareness Training - Part 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark as Complete/ }));

    expect(mocks.markVideoComplete).toHaveBeenCalledWith('sat-1');
  });

  it('shows the all done screen, with no video, once training is valid', () => {
    mocks.completions = rows({ videoIds: GENERAL, days: 10 });

    renderGeneral();

    expect(screen.getByText('All Training Videos Completed!')).toBeInTheDocument();
    expect(screen.queryByTitle(/Security Awareness Training - Part/)).not.toBeInTheDocument();
  });

  it('offers the videos again when the renewal is due, as if none had been watched', () => {
    mocks.completions = rows({ videoIds: GENERAL, days: 330 });

    renderGeneral();

    expect(screen.queryByText('All Training Videos Completed!')).not.toBeInTheDocument();
    expect(screen.getByTitle('Security Awareness Training - Part 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark as Complete/ }));

    expect(mocks.markVideoComplete).toHaveBeenCalledWith('sat-1');
  });

  it('does not treat last year as this renewal when the training has expired', () => {
    mocks.completions = rows({ videoIds: GENERAL, days: 400 });

    renderGeneral();

    expect(screen.getByRole('button', { name: /Mark as Complete/ })).toBeEnabled();
    expect(screen.queryByText('Video Completed')).not.toBeInTheDocument();
  });

  it('picks the renewal up where the member left it', () => {
    mocks.completions = [
      ...rows({ videoIds: GENERAL, cycle: 1, days: 400 }),
      ...rows({ videoIds: ['sat-1'], cycle: 2, days: 1 }),
    ];

    renderGeneral();

    expect(screen.getByText('Video Completed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next Video/ })).toBeInTheDocument();
  });

  it('plays the two CCPA videos for the CCPA group', () => {
    render(<VideoCarousel groupId="ccpa" videos={ccpaTrainingVideos} />);

    const frame = screen.getByTitle('CCPA Privacy Training - Part 1');
    expect(frame).toHaveAttribute('src', expect.stringContaining('GWIPHndskVY'));
    fireEvent.click(screen.getByRole('button', { name: /Mark as Complete/ }));

    expect(mocks.markVideoComplete).toHaveBeenCalledWith('ccpa-1');
  });

  it('is not affected by general training when showing CCPA progress', () => {
    mocks.completions = rows({ videoIds: GENERAL, days: 10 });

    render(<VideoCarousel groupId="ccpa" videos={ccpaTrainingVideos} />);

    expect(screen.queryByText('All Training Videos Completed!')).not.toBeInTheDocument();
    expect(screen.getByTitle('CCPA Privacy Training - Part 1')).toBeInTheDocument();
  });
});
