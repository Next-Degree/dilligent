import type { Member, Policy, User } from '@db';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgId: 'org_123' }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { EmployeeCompletionChart } from './EmployeeCompletionChart';

const DAY_MS = 24 * 60 * 60 * 1000;
const GENERAL = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'];

const employee = {
  id: 'mem_1',
  user: { name: 'Jane Doe', email: 'jane@example.com' },
} as unknown as Member & { user: User };

const rows = ({
  videoIds,
  cycle = 1,
  days,
}: {
  videoIds: string[];
  cycle?: number;
  days: number;
}) =>
  videoIds.map((videoId) => ({
    memberId: 'mem_1',
    videoId,
    cycle,
    completedAt: new Date(Date.now() - days * DAY_MS),
  }));

const renderChart = (props: Partial<React.ComponentProps<typeof EmployeeCompletionChart>>) =>
  render(
    <EmployeeCompletionChart
      employees={[employee]}
      policies={[{ id: 'pol_1', signedBy: ['mem_1'] } as unknown as Policy]}
      trainingCompletions={[]}
      requiredGroupIds={[]}
      {...props}
    />,
  );

describe('EmployeeCompletionChart training summary', () => {
  it('shows general training progress from the completed videos', () => {
    renderChart({
      requiredGroupIds: ['general'],
      trainingCompletions: rows({ videoIds: GENERAL.slice(0, 3), days: 5 }),
    });

    expect(screen.getByText(/3\/5 training/)).toBeInTheDocument();
  });

  it('shows CCPA progress alongside general training', () => {
    renderChart({
      requiredGroupIds: ['general', 'ccpa'],
      trainingCompletions: [
        ...rows({ videoIds: GENERAL, days: 10 }),
        ...rows({ videoIds: ['ccpa-1'], days: 10 }),
      ],
    });

    const summary = screen.getByText(/policies signed/);
    expect(summary).toHaveTextContent('5/5 training');
    expect(summary).toHaveTextContent('CCPA 1/2');
  });

  it('shows HIPAA as pending until it is acknowledged, then done', () => {
    const { unmount } = renderChart({ requiredGroupIds: ['hipaa'] });
    expect(screen.getByText(/policies signed/)).toHaveTextContent('HIPAA pending');
    unmount();

    renderChart({
      requiredGroupIds: ['hipaa'],
      trainingCompletions: rows({ videoIds: ['hipaa-sat-1'], days: 2 }),
    });
    expect(screen.getByText(/policies signed/)).toHaveTextContent('HIPAA done');
  });

  it('counts an employee with an old and a renewed cycle once, not twice', () => {
    renderChart({
      requiredGroupIds: ['general'],
      trainingCompletions: [
        ...rows({ videoIds: GENERAL, cycle: 1, days: 400 }),
        ...rows({ videoIds: GENERAL, cycle: 2, days: 3 }),
      ],
    });

    expect(screen.getByText(/policies signed/)).toHaveTextContent('5/5 training');
  });

  it('keeps counting training that is only due for renewal as done', () => {
    renderChart({
      requiredGroupIds: ['general'],
      trainingCompletions: rows({ videoIds: GENERAL, days: 330 }),
    });

    expect(screen.getByText(/policies signed/)).toHaveTextContent('5/5 training');
  });

  it('shows no training in the summary when none is required', () => {
    renderChart({});

    expect(screen.getByText(/policies signed/)).not.toHaveTextContent('training');
  });
});
