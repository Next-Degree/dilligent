import { render, screen } from '@testing-library/react';
import { Accordion } from '@trycompai/design-system';
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
}));

vi.mock('@/hooks/use-training-completions', () => ({
  useTrainingCompletions: () => ({
    completions: mocks.completions,
    markVideoComplete: vi.fn(),
  }),
}));

import { CcpaTrainingAccordionItem } from './CcpaTrainingAccordionItem';
import { GeneralTrainingAccordionItem } from './GeneralTrainingAccordionItem';

const DAY_MS = 24 * 60 * 60 * 1000;
const GENERAL = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'];

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

const renderGeneral = () =>
  render(
    <Accordion>
      <GeneralTrainingAccordionItem />
    </Accordion>,
  );

describe('General training accordion item', () => {
  beforeEach(() => {
    mocks.completions = [];
  });

  it('shows progress through the videos while training is unfinished', () => {
    mocks.completions = rows({ videoIds: GENERAL.slice(0, 2), days: 3 });

    renderGeneral();

    expect(screen.getByText('Security Awareness Training')).toBeInTheDocument();
    expect(screen.getByText('2/5')).toBeInTheDocument();
  });

  it('shows no badge once training is valid', () => {
    mocks.completions = rows({ videoIds: GENERAL, days: 10 });

    renderGeneral();

    expect(screen.queryByText(/\/5/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Renew by/)).not.toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('says when a renewal is due and by when', () => {
    mocks.completions = rows({ videoIds: GENERAL, days: 330 });

    renderGeneral();

    expect(screen.getByText(/Renew by/)).toBeInTheDocument();
  });

  it('says when training has expired', () => {
    mocks.completions = rows({ videoIds: GENERAL, days: 400 });

    renderGeneral();

    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('counts renewal progress rather than last year once expired', () => {
    mocks.completions = [
      ...rows({ videoIds: GENERAL, cycle: 1, days: 400 }),
      ...rows({ videoIds: GENERAL.slice(0, 2), cycle: 2, days: 1 }),
    ];

    renderGeneral();

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('2/5')).toBeInTheDocument();
  });
});

describe('CCPA training accordion item', () => {
  beforeEach(() => {
    mocks.completions = [];
  });

  it('shows progress through the two CCPA videos', () => {
    mocks.completions = rows({ videoIds: ['ccpa-1'], days: 2 });

    render(
      <Accordion>
        <CcpaTrainingAccordionItem />
      </Accordion>,
    );

    expect(screen.getByText('CCPA Privacy Training')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('is not marked done by general training', () => {
    mocks.completions = rows({ videoIds: GENERAL, days: 10 });

    render(
      <Accordion>
        <CcpaTrainingAccordionItem />
      </Accordion>,
    );

    expect(screen.getByText('0/2')).toBeInTheDocument();
  });
});
