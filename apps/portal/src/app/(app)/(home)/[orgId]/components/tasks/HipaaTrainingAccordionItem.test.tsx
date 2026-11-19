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
  markVideoComplete: vi.fn(),
}));

vi.mock('@/hooks/use-training-completions', () => ({
  useTrainingCompletions: () => ({
    completions: mocks.completions,
    markVideoComplete: mocks.markVideoComplete,
  }),
}));

import { HipaaTrainingAccordionItem } from './HipaaTrainingAccordionItem';

const DAY_MS = 24 * 60 * 60 * 1000;

const hipaaRow = ({ cycle = 1, days }: { cycle?: number; days: number }): CompletionRow => ({
  id: `evc_hipaa_${cycle}`,
  memberId: 'mem_1',
  videoId: 'hipaa-sat-1',
  cycle,
  dueAt: null,
  completedAt: new Date(Date.now() - days * DAY_MS),
});

const renderOpen = () =>
  render(
    <Accordion defaultValue={['hipaa-training']}>
      <HipaaTrainingAccordionItem />
    </Accordion>,
  );

describe('HIPAA training accordion item', () => {
  beforeEach(() => {
    mocks.completions = [];
  });

  it('asks a new member to acknowledge the training', () => {
    renderOpen();

    expect(screen.getByText('HIPAA Security Awareness Training')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge HIPAA Training' })).toBeInTheDocument();
    expect(screen.queryByText('HIPAA training acknowledged')).not.toBeInTheDocument();
  });

  it('shows the acknowledged banner, not the form, while the acknowledgement is valid', () => {
    mocks.completions = [hipaaRow({ days: 10 })];

    renderOpen();

    expect(screen.getByText('HIPAA training acknowledged')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Acknowledge HIPAA Training' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Renew by/)).not.toBeInTheDocument();
  });

  it('offers the acknowledgement again when a renewal is due, saying by when', () => {
    mocks.completions = [hipaaRow({ days: 330 })];

    renderOpen();

    expect(screen.getByText(/Renew by/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge HIPAA Training' })).toBeInTheDocument();
    expect(screen.queryByText('HIPAA training acknowledged')).not.toBeInTheDocument();
  });

  it('asks for the acknowledgement again once it has expired', () => {
    mocks.completions = [hipaaRow({ days: 400 })];

    renderOpen();

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge HIPAA Training' })).toBeInTheDocument();
  });

  it('shows the acknowledged banner again once a renewal is acknowledged', () => {
    mocks.completions = [hipaaRow({ cycle: 1, days: 400 }), hipaaRow({ cycle: 2, days: 1 })];

    renderOpen();

    expect(screen.getByText('HIPAA training acknowledged')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });
});
