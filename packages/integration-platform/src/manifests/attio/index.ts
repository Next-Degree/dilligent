/**
 * Attio Integration Manifest
 *
 * Attio is a CRM. For compliance the questions it answers are who holds a workspace
 * seat and at what privilege — so the checks read `GET /v2/workspace_members` and label
 * evidence with the workspace from `GET /v2/self`.
 *
 * There is deliberately no 2FA check here. No Attio API exposes MFA or SSO state: not
 * the REST API, and not the SCIM 2.0 API at /scim/v2 — which is worth naming, because
 * it is absent from the published OpenAPI document, so that document alone is not proof
 * of what Attio exposes. Attio's SSO is SAML, Enterprise-plan, and configured purely in
 * the UI with no API surface at all. Per-user enrolment therefore cannot be read or
 * evidenced from here; the org's configured 2FA source answers that instead.
 *
 * API Documentation: https://docs.attio.com/rest-api/overview
 */

import type { IntegrationManifest } from '../../types';
import { logoUrl } from '@trycompai/utils';
import { accessReviewCheck, appAvailabilityCheck, employeeAccessCheck } from './checks';
import { maxAdminsVariable } from './variables';

export const attioManifest: IntegrationManifest = {
  id: 'attio',
  name: 'Attio',
  description: 'Monitor Attio CRM workspace membership, privileges, and connection health',
  category: 'Productivity',
  logoUrl: logoUrl('attio.com'),
  docsUrl: 'https://docs.attio.com/rest-api/overview',
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
      setupInstructions: `You must be an Attio workspace admin to create an access token.

1. Log in to Attio at https://app.attio.com
2. From the dropdown beside your workspace name, click Workspace settings
3. Click the Developers tab
4. Click "+ New access token" and give it a name (e.g. "Dilligent")
5. Under Scopes, enable "User management" read access
6. Copy the token and paste it below

Only read access is needed — Dilligent never writes to your Attio workspace. Tokens do
not expire, and you can add the scope later via Edit if you miss it.`,
    },
  },

  credentialFields: [
    {
      id: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'Paste your Attio API key',
      helpText: 'Attio > Workspace settings > Developers > + New access token',
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
      id: 'monitoring',
      name: 'Monitoring',
      description: 'Confirm the Attio connection is live and holds the access the checks need',
      enabledByDefault: true,
      implemented: true,
    },
  ],

  variables: [maxAdminsVariable],

  checks: [employeeAccessCheck, accessReviewCheck, appAvailabilityCheck],
};

export default attioManifest;
export * from './types';
