/**
 * Guards magic link token storage.
 *
 * Magic link tokens are stored hashed (defense in depth). GHSA-965c-763c-88jm
 * (better-auth < 1.7.7) let an OAuth state row be redeemed as a plain-stored
 * magic link token; hashing kept the two apart before the upgrade and still
 * keeps raw tokens out of the database. The global
 * `verification.storeIdentifier` must stay unset or "plain": a hashed
 * identifier makes verify also accept the raw value.
 */

const mockMagicLink = jest.fn((options: unknown) => ({
  id: 'magic-link',
  options,
}));
const mockBetterAuth = jest.fn((options: unknown) => ({ options }));

jest.mock('../config/load-env', () => ({}));
jest.mock('@trycompai/email', () => ({
  ChangeEmailConfirmationEmail: jest.fn(),
  MagicLinkEmail: jest.fn(),
  OTPVerificationEmail: jest.fn(),
  VerifyEmail: jest.fn(),
}));
jest.mock('../email/trigger-email', () => ({ triggerEmail: jest.fn() }));
jest.mock('../email/templates/invite-member', () => ({
  InviteEmail: jest.fn(),
}));
jest.mock('@db', () => ({ db: {} }));
jest.mock('better-auth', () => ({ betterAuth: mockBetterAuth }));
jest.mock('better-auth/adapters/prisma', () => ({
  prismaAdapter: jest.fn(() => ({})),
}));
jest.mock('better-auth/plugins', () => ({
  admin: jest.fn(() => ({})),
  bearer: jest.fn(() => ({})),
  emailOTP: jest.fn(() => ({})),
  magicLink: mockMagicLink,
  multiSession: jest.fn(() => ({})),
  organization: jest.fn(() => ({})),
}));
jest.mock('better-auth/api', () => ({
  APIError: class APIError extends Error {},
  createAuthMiddleware: jest.fn((handler: unknown) => handler),
  getSessionFromCtx: jest.fn(),
}));
jest.mock('better-auth/crypto', () => ({ verifyJWT: jest.fn() }));
jest.mock('@trycompai/auth', () => ({ ac: {}, allRoles: {} }));
jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
  })),
}));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('magic link token storage', () => {
  const originalSecret = process.env.SECRET_KEY;

  beforeAll(() => {
    process.env.SECRET_KEY = 'test-secret-key-at-least-16-chars';
    jest.isolateModules(() => {
      require('./auth.server');
    });
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.SECRET_KEY;
      return;
    }
    process.env.SECRET_KEY = originalSecret;
  });

  it('stores magic link tokens hashed', () => {
    expect(mockMagicLink).toHaveBeenCalledTimes(1);
    expect(mockMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ storeToken: 'hashed' }),
    );
  });

  it('does not hash the global verification identifier', () => {
    expect(mockBetterAuth).toHaveBeenCalledTimes(1);
    const options: unknown = mockBetterAuth.mock.calls[0]?.[0];
    expect(isRecord(options)).toBe(true);
    if (!isRecord(options)) return;

    const verification = options.verification;
    const storeIdentifier = isRecord(verification)
      ? verification.storeIdentifier
      : undefined;
    expect([undefined, 'plain']).toContain(storeIdentifier);
  });
});
