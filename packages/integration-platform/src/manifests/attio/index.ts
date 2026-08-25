/**
 * Attio Integration Manifest
 *
 * Attio is a CRM. For compliance the questions it answers are who holds a workspace
 * seat, at what privilege, and whether those accounts sit inside the org's identity
 * perimeter — so the checks read `GET /v2/workspace_members` and label evidence with
 * the workspace from `GET /v2/self`.
 *
 * Attio's API exposes no MFA or SSO state anywhere in its published OpenAPI document,
 * which is why the 2FA check attests identity-provider coverage rather than per-user
 * enrolment. See checks/two-factor-auth.ts for the full reasoning.
 *
 * API Documentation: https://docs.attio.com/rest-api
 */

import type { IntegrationManifest } from '../../types';
import { accessReviewCheck, employeeAccessCheck, twoFactorAuthCheck } from './checks';
import { approvedIdentityDomainsVariable, maxAdminsVariable } from './variables';

export const attioManifest: IntegrationManifest = {
  id: 'attio',
  name: 'Attio',
  description: 'Monitor Attio CRM workspace membership, privileges, and 2FA coverage',
  category: 'Productivity',
  logoUrl: 'https://img.logo.dev/attio.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ',
  docsUrl: 'https://docs.attio.com/rest-api',
  isActive: true,

  baseUrl: 'https://api.attio.com',
  defaultHeaders: {
    Accept: 'application/json',
  },

  /**
   * Attio accepts both API keys and OAuth tokens as `Authorization: Bearer <token>`.
   * `api_key` is the right strategy here — the runtime's `buildHeaders` injects the
   * header automatically, and a workspace API key belongs to the workspace rather than
   * to the person who created it, so it survives their offboarding.
   */
  auth: {
    type: 'api_key',
    config: {
      in: 'header',
      name: 'Authorization',
      prefix: 'Bearer ',
      setupInstructions: `1. Log in to Attio at https://app.attio.com
2. Go to Workspace settings > Developers
3. Click "Create an integration", name it (e.g. "Dilligent"), then open its API key
4. Under Access, enable the "User management" > Read scope
5. Copy the key and paste it below

Only the read scope is needed — Dilligent never writes to your Attio workspace.`,
    },
  },

  credentialFields: [
    {
      id: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'Paste your Attio API key',
      helpText: 'Attio > Workspace settings > Developers > your integration > API key',
    },
  ],

  capabilities: ['checks'],
  supportsMultipleConnections: false,

  services: [
    {
      id: 'user-management',
      name: 'User Management',
      description: 'Review who holds an Attio workspace seat and at what privilege',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'mfa-compliance',
      name: 'MFA Compliance',
      description: 'Confirm Attio accounts sit inside an identity provider that enforces 2FA',
      enabledByDefault: true,
      implemented: true,
    },
  ],

  variables: [approvedIdentityDomainsVariable, maxAdminsVariable],

  checks: [employeeAccessCheck, twoFactorAuthCheck, accessReviewCheck],
};

export default attioManifest;
export * from './types';
