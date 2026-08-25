/**
 * Contract test against the members payload exactly as PostHog documents it
 * (https://posthog.com/docs/api/members), fed through both checks verbatim.
 *
 * The fixtures elsewhere in this folder are shapes we build ourselves, so they can only
 * prove the checks are self-consistent. This one proves they read the real envelope:
 * every field the checks touch is present here under the name PostHog actually sends,
 * and fields we deliberately don't model (`hedgehog_config`, `search_match_type`) are
 * left in to confirm they pass through harmlessly.
 */

import { describe, expect, it } from 'bun:test';
import { twoFactorAuthCheck } from '../checks/two-factor-auth';
import { validAccountsCheck } from '../checks/valid-accounts';
import { createMockContext, type Emitted, type MockFixtures } from './mock-context';

const ORGANIZATION_ID = 'org-acme';

/** Verbatim from PostHog's documented example response for GET .../members/. */
const DOCUMENTED_MEMBERS_RESPONSE = {
  count: 123,
  next: 'http://api.example.org/accounts/?offset=400&limit=100',
  previous: 'http://api.example.org/accounts/?offset=200&limit=100',
  results: [
    {
      id: '497f6eca-6276-4993-bfeb-53cbbbba6f08',
      user: {
        id: 0,
        uuid: '095be615-a8ad-4c33-8e9c-c7612fbf6c9f',
        distinct_id: 'string',
        first_name: 'string',
        last_name: 'string',
        email: 'user@example.com',
        is_email_verified: true,
        hedgehog_config: {},
        role_at_organization: 'engineering',
      },
      level: 1,
      joined_at: '2019-08-24T14:15:22Z',
      updated_at: '2019-08-24T14:15:22Z',
      is_2fa_enabled: true,
      has_social_auth: true,
      last_login: '2019-08-24T14:15:22Z',
      search_match_type: 'exact',
    },
  ],
};

const fixtures: MockFixtures = {
  organizations: [{ id: ORGANIZATION_ID, name: 'Acme', slug: 'acme' }],
  organizationDetail: {
    [ORGANIZATION_ID]: { id: ORGANIZATION_ID, name: 'Acme', slug: 'acme', enforce_2fa: true },
  },
  rawResponses: {
    [`/api/organizations/${ORGANIZATION_ID}/members/`]: DOCUMENTED_MEMBERS_RESPONSE,
  },
};

const byResource = (emitted: Emitted[], resourceId: string) =>
  emitted.find((e) => e.resourceId === resourceId);

describe('documented members payload', () => {
  it('reads every field the valid-accounts check needs', async () => {
    const ctx = createMockContext(fixtures);

    await validAccountsCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    const pass = byResource(ctx._passes, 'user@example.com');
    expect(pass?.resourceType).toBe('user');

    // Nothing here should be null: a null would mean a field name drifted.
    expect(pass?.evidence).toMatchObject({
      email: 'user@example.com',
      name: 'string string',
      role: 'Member',
      level: 1,
      isAdmin: false,
      domain: 'example.com',
      isEmailVerified: true,
      hasSocialAuth: true,
      organization: 'Acme',
      organizationId: ORGANIZATION_ID,
      externalId: '095be615-a8ad-4c33-8e9c-c7612fbf6c9f',
      joinedAt: '2019-08-24T14:15:22Z',
      lastLogin: '2019-08-24T14:15:22Z',
    });
  });

  it('reads every field the 2FA check needs', async () => {
    const ctx = createMockContext(fixtures);

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    const pass = byResource(ctx._passes, 'user@example.com');
    expect(pass?.title).toBe('2FA Enabled');
    expect(pass?.evidence).toMatchObject({
      email: 'user@example.com',
      is2faEnabled: true,
      hasSocialAuth: true,
      // is_2fa_enabled is true on its own, so the SSO fallback must not be what passed it.
      coveredBySso: false,
      lastLogin: '2019-08-24T14:15:22Z',
    });
  });

  it('stops paging on a short page even though the envelope advertises a next page', async () => {
    const ctx = createMockContext(fixtures);

    await validAccountsCheck.run(ctx);

    // `next` is set but only one record came back, so a second request would re-read the
    // same page forever. One request is the whole point of the short-page guard.
    const memberRequests = ctx._requests.filter((request) => request.path.endsWith('/members/'));
    expect(memberRequests).toHaveLength(1);
    expect(memberRequests[0]?.params).toMatchObject({ limit: '100', offset: '0' });
  });
});
