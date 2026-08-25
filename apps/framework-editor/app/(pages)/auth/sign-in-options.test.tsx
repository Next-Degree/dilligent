import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The ui package ships untranspiled JSX in dist; stub the bits this screen uses.
vi.mock('@trycompai/ui', () => ({
  Button: ({
    children,
    variant: _v,
    ...props
  }: { variant?: string } & React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('./google-sign-in', () => ({
  GoogleSignIn: () => <button type="button">Sign in with Google</button>,
}));
vi.mock('./magic-link-sign-in', () => ({
  MagicLinkSignIn: ({ onMagicLinkSent }: { onMagicLinkSent: (email: string) => void }) => (
    <button type="button" onClick={() => onMagicLinkSent('someone@nextdegree.org')}>
      Continue with email
    </button>
  ),
}));

import { SignInOptions } from './sign-in-options';

describe('SignInOptions', () => {
  it('offers both Google and magic link sign in', () => {
    render(<SignInOptions />);

    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /continue with email/i })).toBeDefined();
  });

  it('shows the confirmation screen once a magic link is sent', () => {
    render(<SignInOptions />);

    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }));

    expect(screen.getByText(/magic link sent/i)).toBeDefined();
    expect(screen.getByText('someone@nextdegree.org')).toBeDefined();
    expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull();
  });

  it('returns to the sign in options from the confirmation screen', () => {
    render(<SignInOptions />);

    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }));
    fireEvent.click(screen.getByRole('button', { name: /use another method/i }));

    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeDefined();
    expect(screen.queryByText(/magic link sent/i)).toBeNull();
  });
});
