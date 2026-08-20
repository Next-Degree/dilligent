import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionReconnectBanner } from './ConnectionReconnectBanner';

describe('ConnectionReconnectBanner', () => {
  it('explains a scope gap as a missing permission, not a stale connection', () => {
    render(
      <ConnectionReconnectBanner
        reason="missing-scopes"
        missingScopes={['https://www.googleapis.com/auth/admin.directory.user.security']}
        onReconnect={vi.fn()}
      />,
    );

    expect(screen.getByText('Additional permission needed')).toBeInTheDocument();
    // Reassures that reconnecting is additive — the common fear is losing the connection.
    expect(screen.getByText(/existing access is kept/i)).toBeInTheDocument();
  });

  it('pluralises the permission count', () => {
    render(
      <ConnectionReconnectBanner
        reason="missing-scopes"
        missingScopes={['scope.a', 'scope.b']}
        onReconnect={vi.fn()}
      />,
    );

    expect(screen.getByText(/2 permissions we now need were added/i)).toBeInTheDocument();
  });

  it('keeps the existing cloud-cutoff wording for that reason', () => {
    render(<ConnectionReconnectBanner reason="cloud-cutoff" onReconnect={vi.fn()} />);

    expect(screen.getByText('Reconnect this account')).toBeInTheDocument();
    expect(screen.getByText(/scans and remediation/i)).toBeInTheDocument();
  });

  it('invokes the reconnect handler', async () => {
    const onReconnect = vi.fn();
    render(
      <ConnectionReconnectBanner
        reason="missing-scopes"
        missingScopes={['scope.a']}
        onReconnect={onReconnect}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /reconnect/i }));

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
