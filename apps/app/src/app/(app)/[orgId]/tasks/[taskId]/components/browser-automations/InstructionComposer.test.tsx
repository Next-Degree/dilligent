import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createContext, useContext, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface SelectContextValue {
  value: string;
  onValueChange: (next: string) => void;
}

const MockSelectContext = createContext<SelectContextValue | null>(null);

function useMockSelect(): SelectContextValue {
  const ctx = useContext(MockSelectContext);
  if (!ctx) throw new Error('Select components must be used within Select');
  return ctx;
}

// The real Select renders its options into a popup that jsdom can't drive with
// fireEvent. Swap in a flat, clickable stand-in (the repo's established pattern)
// so these tests exercise the composer's logic, not the popup's.
vi.mock('@trycompai/design-system', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children: ReactNode;
  }) => (
    <MockSelectContext.Provider value={{ value, onValueChange }}>
      <div>{children}</div>
    </MockSelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <button type="button" role="combobox" {...props}>
      {children}
    </button>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({
    placeholder,
    children,
  }: {
    placeholder?: string;
    // The real component passes the selected value to a render-prop child.
    children?: ReactNode | ((value: string | null) => ReactNode);
  }) => {
    const { value } = useMockSelect();
    if (typeof children === 'function') return <span>{children(value || null)}</span>;
    return <span>{value ? (children ?? value) : placeholder}</span>;
  },
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
    const { onValueChange } = useMockSelect();
    return (
      <div role="option" onClick={() => onValueChange(value)}>
        {children}
      </div>
    );
  },
}));

const startTest = vi.fn();
const closeTestSession = vi.fn();

vi.mock('../../hooks/useInstructionTest', () => ({
  useInstructionTest: () => ({ startTest, closeTestSession, isStarting: false }),
}));

vi.mock('@trigger.dev/react-hooks', () => ({
  useRealtimeRun: () => ({ run: undefined, error: undefined }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { InstructionComposer, type ConnectionRef } from './InstructionComposer';

const connection: ConnectionRef = {
  profileId: 'prof_1',
  hostname: 'app.example.com',
  displayName: 'Statushub',
  url: 'https://app.example.com',
  status: 'verified',
};

const baseProps = {
  taskId: 'task_1',
  connection,
  connections: [connection],
  isSaving: false,
  onCancel: vi.fn(),
  onCreate: vi.fn().mockResolvedValue(true),
  onUpdate: vi.fn().mockResolvedValue(true),
  onSaved: vi.fn(),
};

describe('InstructionComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startTest.mockResolvedValue({
      runId: 'run_1',
      publicAccessToken: 'tok',
      sessionId: 'sess_1',
      liveViewUrl: 'https://live/view',
    });
  });

  it('renders the create heading and multi-step actions', () => {
    render(<InstructionComposer {...baseProps} mode="create" />);
    expect(screen.getByText('New automation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save automation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add step/i })).toBeInTheDocument();
  });

  it('tests the active step against its connection URL', async () => {
    render(<InstructionComposer {...baseProps} mode="create" />);
    fireEvent.change(screen.getByPlaceholderText(/screenshot the two-factor/i), {
      target: { value: 'Screenshot the MFA policy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test this step/i }));

    await waitFor(() => expect(startTest).toHaveBeenCalledTimes(1));
    expect(startTest).toHaveBeenCalledWith({
      authMode: 'saved_session',
      profileId: 'prof_1',
      targetUrl: 'https://app.example.com',
      instruction: 'Screenshot the MFA policy',
      evaluationCriteria: undefined,
      taskId: 'task_1',
    });
  });

  it('sends the pass/fail check when the criteria field is filled', async () => {
    render(<InstructionComposer {...baseProps} mode="create" />);
    fireEvent.change(screen.getByPlaceholderText(/screenshot the two-factor/i), {
      target: { value: 'Capture security page' },
    });
    fireEvent.change(screen.getByPlaceholderText(/two-factor authentication is enforced/i), {
      target: { value: 'MFA is on' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test this step/i }));

    await waitFor(() => expect(startTest).toHaveBeenCalledTimes(1));
    expect(startTest.mock.calls[0][0].evaluationCriteria).toBe('MFA is on');
  });

  it('adds another step', () => {
    render(<InstructionComposer {...baseProps} mode="create" />);
    expect(screen.getByText('1 step')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add step/i }));
    expect(screen.getByText('2 steps')).toBeInTheDocument();
  });

  it('saves as a one-step automation with a derived name and steps[]', async () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(
      <InstructionComposer
        {...baseProps}
        mode="edit"
        onUpdate={onUpdate}
        initialValues={{
          id: 'auto_1',
          instruction: 'Screenshot the billing page',
          evaluationCriteria: null,
          targetUrl: 'https://app.example.com',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save automation/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith({
      automationId: 'auto_1',
      input: {
        name: 'Screenshot the billing page',
        targetUrl: 'https://app.example.com',
        instruction: 'Screenshot the billing page',
        evaluationCriteria: undefined,
        steps: [
          {
            authMode: 'saved_session',
            profileId: 'prof_1',
            targetUrl: 'https://app.example.com',
            instruction: 'Screenshot the billing page',
            evaluationCriteria: undefined,
          },
        ],
      },
    });
  });
});

describe('InstructionComposer public steps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startTest.mockResolvedValue({
      runId: 'run_1',
      publicAccessToken: 'tok',
      sessionId: 'sess_1',
      liveViewUrl: 'https://live/view',
    });
  });

  /** Switch the active step to public mode and give it a URL + instruction. */
  const composePublicStep = (url = 'https://example.com/privacy') => {
    fireEvent.click(screen.getByRole('option', { name: /public page/i }));
    fireEvent.change(screen.getByLabelText('Page URL'), { target: { value: url } });
    fireEvent.change(screen.getByPlaceholderText(/screenshot the two-factor/i), {
      target: { value: 'Screenshot the privacy policy' },
    });
  };

  it('saves a public step with no connection and the URL the user typed', async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(<InstructionComposer {...baseProps} mode="create" onCreate={onCreate} />);

    composePublicStep();
    fireEvent.click(screen.getByRole('button', { name: /save automation/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].steps).toEqual([
      {
        authMode: 'public',
        // Never the primary connection's id — a public step binds nothing.
        profileId: null,
        targetUrl: 'https://example.com/privacy',
        instruction: 'Screenshot the privacy policy',
        evaluationCriteria: undefined,
      },
    ]);
  });

  it('tests a public step against its own URL, sending no profileId', async () => {
    render(<InstructionComposer {...baseProps} mode="create" />);

    composePublicStep();
    fireEvent.click(screen.getByRole('button', { name: /test this step/i }));

    await waitFor(() => expect(startTest).toHaveBeenCalledTimes(1));
    expect(startTest).toHaveBeenCalledWith({
      authMode: 'public',
      profileId: undefined,
      targetUrl: 'https://example.com/privacy',
      instruction: 'Screenshot the privacy policy',
      evaluationCriteria: undefined,
      taskId: 'task_1',
    });
  });

  it('does not show a reconnect prompt on a public step', () => {
    const unverified: ConnectionRef = { ...connection, status: 'needs_reauth' };
    render(
      <InstructionComposer
        {...baseProps}
        connection={unverified}
        connections={[unverified]}
        mode="create"
      />,
    );

    // The saved-session step inherits the connection's reconnect prompt…
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();

    composePublicStep();

    // …and switching to public drops it: there's no connection to reconnect.
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument();
  });

  it('lets a public step save while an unrelated connection is unverified', () => {
    const unverified: ConnectionRef = { ...connection, status: 'needs_reauth' };
    render(
      <InstructionComposer
        {...baseProps}
        connection={unverified}
        connections={[unverified]}
        mode="create"
      />,
    );

    expect(screen.getByRole('button', { name: /fix step 1 to save/i })).toBeDisabled();

    composePublicStep();

    expect(screen.getByRole('button', { name: /save automation/i })).toBeEnabled();
  });

  it('blocks saving a public step until its URL is usable', () => {
    render(<InstructionComposer {...baseProps} mode="create" />);

    composePublicStep('example.com/privacy');

    // A bare host has no scheme for the run to open.
    expect(screen.getByRole('button', { name: /fix step 1 to save/i })).toBeDisabled();
  });

  it('opens with a public step when the org has no connections at all', () => {
    render(
      <InstructionComposer {...baseProps} connection={undefined} connections={[]} mode="create" />,
    );

    expect(screen.getByText('New automation')).toBeInTheDocument();
    expect(screen.getByLabelText('Page URL')).toBeInTheDocument();
  });

  it('restores a public draft step with its URL', () => {
    render(
      <InstructionComposer
        {...baseProps}
        mode="create"
        draftSteps={[
          {
            authMode: 'public',
            targetUrl: 'https://example.com/terms',
            instruction: 'Screenshot the terms',
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('Page URL')).toHaveValue('https://example.com/terms');
  });
});
