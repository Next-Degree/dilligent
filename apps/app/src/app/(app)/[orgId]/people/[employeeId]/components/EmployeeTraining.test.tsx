import { buildTrainingGroupView } from '@/lib/training/training-view';
import type { Member, Organization, User } from '@db';
import { getTrainingGroup, type TrainingGroupId } from '@trycompai/company';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions/download-training-certificate', () => ({
  downloadTrainingCertificate: vi.fn(),
}));
vi.mock('../actions/download-hipaa-certificate', () => ({
  downloadHipaaCertificate: vi.fn(),
}));

import { EmployeeHipaaTraining, EmployeeTrainingVideos } from './EmployeeTraining';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const employee = {
  id: 'mem_1',
  user: { name: 'Jane Doe', email: 'jane@example.com' },
} as unknown as Member & { user: User };

const organization = (securityTrainingStepEnabled: boolean) =>
  ({ id: 'org_1', securityTrainingStepEnabled }) as unknown as Organization;

const view = ({
  groupId,
  completions = [],
}: {
  groupId: TrainingGroupId;
  completions?: Array<{ videoId: string; cycle: number; completedAt: Date }>;
}) => buildTrainingGroupView({ group: getTrainingGroup(groupId), completions, now: new Date() });

const rows = ({
  videoIds,
  cycle = 1,
  days,
}: {
  videoIds: readonly string[];
  cycle?: number;
  days: number;
}) => videoIds.map((videoId) => ({ videoId, cycle, completedAt: daysAgo(days) }));

const GENERAL = getTrainingGroup('general').moduleIds;

describe('EmployeeTrainingVideos (general training)', () => {
  it('shows progress and no certificate while training is unfinished', () => {
    render(
      <EmployeeTrainingVideos
        employee={employee}
        organization={organization(true)}
        view={view({
          groupId: 'general',
          completions: rows({ videoIds: GENERAL.slice(0, 2), days: 3 }),
        })}
      />,
    );

    expect(screen.getByText('2/5 Videos Completed')).toBeInTheDocument();
    expect(screen.getByText('Security Awareness Training - Part 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /certificate/i })).not.toBeInTheDocument();
  });

  it('shows completion and a certificate button once training is finished', () => {
    render(
      <EmployeeTrainingVideos
        employee={employee}
        organization={organization(true)}
        view={view({ groupId: 'general', completions: rows({ videoIds: GENERAL, days: 10 }) })}
      />,
    );

    expect(screen.getByText('All Training Complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /certificate/i })).toBeInTheDocument();
  });

  it('flags training that is due for renewal, and still offers the certificate', () => {
    render(
      <EmployeeTrainingVideos
        employee={employee}
        organization={organization(true)}
        view={view({ groupId: 'general', completions: rows({ videoIds: GENERAL, days: 330 }) })}
      />,
    );

    expect(screen.getByText('Renewal Due')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /certificate/i })).toBeInTheDocument();
  });

  it('shows expired training with renewal progress, not last year as done', () => {
    render(
      <EmployeeTrainingVideos
        employee={employee}
        organization={organization(true)}
        view={view({
          groupId: 'general',
          completions: [
            ...rows({ videoIds: GENERAL, cycle: 1, days: 400 }),
            ...rows({ videoIds: GENERAL.slice(0, 1), cycle: 2, days: 1 }),
          ],
        })}
      />,
    );

    expect(screen.getByText('Training Expired')).toBeInTheDocument();
    expect(screen.getByText(/Renewal: 1\/5 videos completed/)).toBeInTheDocument();
  });

  it('explains that training is managed elsewhere when the org has it switched off', () => {
    render(
      <EmployeeTrainingVideos
        employee={employee}
        organization={organization(false)}
        view={undefined}
      />,
    );

    expect(
      screen.getByText('Security training is managed outside of Dilligent'),
    ).toBeInTheDocument();
  });
});

describe('EmployeeHipaaTraining', () => {
  it('says the acknowledgement is missing when it was never done', () => {
    render(
      <EmployeeHipaaTraining
        employee={employee}
        organization={organization(true)}
        view={view({ groupId: 'hipaa' })}
      />,
    );

    expect(screen.getByText('HIPAA Security Awareness Training Not Completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /certificate/i })).not.toBeInTheDocument();
  });

  it('says it was acknowledged, with a certificate, when it is current', () => {
    render(
      <EmployeeHipaaTraining
        employee={employee}
        organization={organization(true)}
        view={view({ groupId: 'hipaa', completions: rows({ videoIds: ['hipaa-sat-1'], days: 5 }) })}
      />,
    );

    expect(screen.getByText('HIPAA Security Awareness Training Acknowledged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /certificate/i })).toBeInTheDocument();
  });

  it('flags an acknowledgement that has expired', () => {
    render(
      <EmployeeHipaaTraining
        employee={employee}
        organization={organization(true)}
        view={view({
          groupId: 'hipaa',
          completions: rows({ videoIds: ['hipaa-sat-1'], days: 400 }),
        })}
      />,
    );

    expect(screen.getByText('HIPAA Security Awareness Training Expired')).toBeInTheDocument();
  });
});
