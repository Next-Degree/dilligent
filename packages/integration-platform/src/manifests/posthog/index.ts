/**
 * PostHog Integration Manifest
 *
 * PostHog is a product analytics platform. Its organization members hold access to
 * product data, session recordings and feature flags, so the accounts themselves are in
 * scope for access reviews: this integration verifies each account is a valid, verified
 * company mailbox and that every member has two-factor authentication enabled.
 *
 * Auth is a personal API key sent as `Authorization: Bearer <key>`. The key inherits the
 * access of the account that created it, so the setup instructions steer customers to a
 * service account with only the two read scopes the checks need.
 *
 * API Documentation: https://posthog.com/docs/api
 */

import type { IntegrationManifest } from '../../types';
import { twoFactorAuthCheck, validAccountsCheck } from './checks';
import { DEFAULT_POSTHOG_HOST } from './client';

export const posthogManifest: IntegrationManifest = {
  id: 'posthog',
  name: 'PostHog',
  description:
    'Monitor PostHog account hygiene — valid, verified member email addresses and two-factor authentication',
  category: 'Monitoring',
  logoUrl: 'https://img.logo.dev/posthog.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ',
  docsUrl: 'https://posthog.com/docs/api',
  isActive: true,

  baseUrl: DEFAULT_POSTHOG_HOST,
  defaultHeaders: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },

  auth: {
    type: 'api_key',
    config: {
      in: 'header',
      name: 'Authorization',
      prefix: 'Bearer ',
      setupInstructions: `1. Log in to PostHog and open Settings > Personal API keys (https://us.posthog.com/settings/user-api-keys)
2. Click "Create personal API key" and name it "Comp AI"
3. Under Scopes, select read access for:
   - Organization (organization:read)
   - Organization member (organization_member:read)
4. Under Organization & project access, allow the organizations you want reviewed
5. Copy the key (it is shown once) and paste it below
6. If your PostHog is in the EU region or self-hosted, set Host to your instance URL (for example https://eu.posthog.com)

The key inherits the access of the account that created it, so prefer a service account over a personal one — a personal key stops working when that person is offboarded.`,
    },
  },

  credentialFields: [
    {
      id: 'api_key',
      label: 'Personal API Key',
      type: 'password',
      required: true,
      placeholder: 'phx_...',
      helpText: 'PostHog > Settings > Personal API keys > Create personal API key',
    },
    {
      id: 'host',
      label: 'Host',
      type: 'url',
      required: false,
      placeholder: DEFAULT_POSTHOG_HOST,
      defaultValue: DEFAULT_POSTHOG_HOST,
      helpText: `Your PostHog instance URL. Use ${DEFAULT_POSTHOG_HOST} for the US region, https://eu.posthog.com for the EU region, or your own domain when self-hosting.`,
    },
  ],

  capabilities: ['checks'],
  supportsMultipleConnections: false,

  checks: [validAccountsCheck, twoFactorAuthCheck],
};

export default posthogManifest;
export * from './types';
