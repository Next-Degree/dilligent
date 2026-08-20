import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAccess } from './EmployeeAccess';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({
  default: (props: { src: string; alt: string }) => <img src={props.src} alt={props.alt} />,
}));

const source = (overrides: object) => ({
  slug: 'google-workspace',
  name: 'Google Workspace',
  logoUrl: null,
  matchType: 'matched',
  entries: [{ id: 'run_1:0', summary: 'Super Admin', fields: { Role: 'Super Admin' }, raw: {} }],
  lastCheckedAt: '2026-07-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('EmployeeAccess source labelling', () => {
  // This card sits beside Third-party app access, which answers a different question from
  // a different source. Without the label, two different counts read as a contradiction.
  //
  // Each test uses its own memberId: SWR's cache is module-global and keyed by it, so
  // sharing one id lets a previous test's response satisfy a later test's first render.
  it('names the connected integrations as the source', async () => {
    mockGet.mockResolvedValue({
      data: { data: { memberId: 'mem_label_1', sources: [source({})] } },
    });

    render(<EmployeeAccess memberId="mem_label_1" organizationId="org_1" />);

    await waitFor(() =>
      expect(screen.getByText(/latest Employee Access check/i)).toBeInTheDocument(),
    );
  });

  it('points at the other card for apps signed into with Google', async () => {
    mockGet.mockResolvedValue({
      data: { data: { memberId: 'mem_label_2', sources: [source({})] } },
    });

    render(<EmployeeAccess memberId="mem_label_2" organizationId="org_1" />);

    await waitFor(() =>
      expect(screen.getByText(/Third-party app access/i)).toBeInTheDocument(),
    );
  });

  it('keeps the label when no integration reports access', async () => {
    // Empty is exactly when someone wonders why the other card is populated.
    mockGet.mockResolvedValue({ data: { data: { memberId: 'mem_label_3', sources: [] } } });

    render(<EmployeeAccess memberId="mem_label_3" organizationId="org_1" />);

    await waitFor(() =>
      expect(screen.getByText(/latest Employee Access check/i)).toBeInTheDocument(),
    );
  });

  it('titles itself distinctly from the third-party card', async () => {
    mockGet.mockResolvedValue({ data: { data: { memberId: 'mem_label_4', sources: [] } } });

    render(<EmployeeAccess memberId="mem_label_4" organizationId="org_1" />);

    await waitFor(() =>
      expect(screen.getByText('Access in connected tools')).toBeInTheDocument(),
    );
  });
});

describe('EmployeeAccess', () => {
  it('lists integrations with the member access summary and match state', async () => {
    mockGet.mockResolvedValue({
      data: { data: { memberId: 'mem_1', sources: [source({}), source({ slug: 'okta', name: 'Okta', matchType: 'not-matched', entries: [] })] } },
    });

    render(<EmployeeAccess memberId="mem_1" organizationId="org_1" />);

    await waitFor(() => expect(screen.getByText('Google Workspace')).toBeInTheDocument());
    expect(screen.getByText('Super Admin')).toBeInTheDocument();
    expect(screen.getByText('Access found')).toBeInTheDocument();
    expect(screen.getByText('No match for this member')).toBeInTheDocument();
  });

  it('labels sources whose checks produce no per-person rows', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: {
          memberId: 'mem_3',
          sources: [source({ matchType: 'no-person-data', entries: [] })],
        },
      },
    });

    render(<EmployeeAccess memberId="mem_3" organizationId="org_1" />);

    await waitFor(() => expect(screen.getByText('No per-person data')).toBeInTheDocument());
  });

  it('expands a matched source to show fields and the raw record', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: {
          memberId: 'mem_4',
          sources: [
            source({
              entries: [
                { id: 'run_1:0', summary: 'Editor seat', fields: { Role: 'Editor' }, raw: { role: 'editor' } },
              ],
            }),
          ],
        },
      },
    });

    render(<EmployeeAccess memberId="mem_4" organizationId="org_1" />);

    await waitFor(() => expect(screen.getByText('Google Workspace')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Google Workspace/ }));

    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
    expect(screen.getByText('Raw record')).toBeInTheDocument();
  });

  it('falls back to a neutral badge for an unknown matchType instead of crashing', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: {
          memberId: 'mem_5',
          // A matchType this build doesn't know (API contract drift).
          sources: [source({ matchType: 'something-new', entries: [] })],
        },
      },
    });

    render(<EmployeeAccess memberId="mem_5" organizationId="org_1" />);

    await waitFor(() => expect(screen.getByText('Google Workspace')).toBeInTheDocument());
    expect(screen.getByText('Check not run yet')).toBeInTheDocument();
  });

  it('shows the connect empty state when no integration reports access', async () => {
    mockGet.mockResolvedValue({ data: { data: { memberId: 'mem_2', sources: [] } } });

    render(<EmployeeAccess memberId="mem_2" organizationId="org_1" />);

    await waitFor(() =>
      expect(
        screen.getByText('No connected integrations report employee access yet.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Browse integrations →')).toHaveAttribute(
      'href',
      '/org_1/integrations',
    );
  });
});
