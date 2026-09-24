/**
 * Attio Integration Manifest
 *
 * Attio is a CRM. For compliance the questions it answers are who holds a workspace
 * seat and at what privilege — so the checks read `GET /v2/workspace_members` and label
 * evidence with the workspace from `GET /v2/self`.
 *
 * There is deliberately no 2FA check here. Attio's API exposes no MFA or SSO state
 * anywhere in its published OpenAPI document, so per-user enrolment cannot be read or
 * evidenced from this integration; the org's configured 2FA source answers that instead.
 *
 * API Documentation: https://docs.attio.com/rest-api
 */

import type { IntegrationManifest } from '../../types';
import { accessReviewCheck, appAvailabilityCheck, employeeAccessCheck } from './checks';
import { maxAdminsVariable } from './variables';

export const attioManifest: IntegrationManifest = {
  id: 'attio',
  name: 'Attio',
  description: 'Monitor Attio CRM workspace membership, privileges, and connection health',
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
