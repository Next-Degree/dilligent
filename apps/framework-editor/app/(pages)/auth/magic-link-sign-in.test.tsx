import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signInMagicLink, toastError } = vi.hoisted(() => ({
  signInMagicLink: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/app/lib/auth-client', () => ({
  authClient: { signIn: { magicLink: signInMagicLink } },
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

// The ui package ships untranspiled JSX in dist; stub the bits the form uses.
vi.mock('@trycompai/ui/button', () => ({
  Button: (props: React.ComponentProps<'button'>) => <button {...props} />,
}));
vi.mock('@trycompai/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

import { MagicLinkSignIn } from './magic-link-sign-in';

const submitEmail = (email: string) => {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /continue with email/i }));
};

describe('MagicLinkSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInMagicLink.mockResolvedValue({ error: null });
  });

  it('sends a magic link for an internal email and reports the address back', async () => {
    const onMagicLinkSent = vi.fn();
    render(<MagicLinkSignIn onMagicLinkSent={onMagicLinkSent} />);

    submitEmail('someone@trycomp.ai');

    await waitFor(() => expect(onMagicLinkSent).toHaveBeenCalledWith('someone@trycomp.ai'));
    expect(signInMagicLink).toHaveBeenCalledWith({
      email: 'someone@trycomp.ai',
      callbackURL: `${window.location.origin}/`,
    });
  });

  it('rejects emails outside the internal domain without calling the API', async () => {
    const onMagicLinkSent = vi.fn();
    render(<MagicLinkSignIn onMagicLinkSent={onMagicLinkSent} />);

    submitEmail('someone@gmail.com');

    expect(await screen.findByText(/use your @trycomp\.ai email address/i)).toBeDefined();
    expect(signInMagicLink).not.toHaveBeenCalled();
    expect(onMagicLinkSent).not.toHaveBeenCalled();
  });

  it('rejects a malformed email without calling the API', async () => {
    render(<MagicLinkSignIn onMagicLinkSent={vi.fn()} />);

    submitEmail('not-an-email');

    expect(await screen.findByText(/enter a valid email address/i)).toBeDefined();
    expect(signInMagicLink).not.toHaveBeenCalled();
  });

  it('surfaces a toast and stays on the form when sending fails', async () => {
    signInMagicLink.mockResolvedValue({ error: { message: 'boom' } });
    const onMagicLinkSent = vi.fn();
    render(<MagicLinkSignIn onMagicLinkSent={onMagicLinkSent} />);

    submitEmail('someone@trycomp.ai');

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onMagicLinkSent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /continue with email/i })).toBeDefined();
  });
});
