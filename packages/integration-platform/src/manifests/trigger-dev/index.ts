/**
 * Trigger.dev Integration Manifest
 *
 * Trigger.dev runs a company's background jobs, so its members can read task payloads,
 * environment variables and run output, and its production environment is part of the
 * application's availability. This integration reviews who holds that access and
 * whether production is separated from staging and actually live.
 *
 * Auth is a Personal Access Token (`tr_pat_...`) sent as `Authorization: Bearer <token>`.
 * Environment secret keys cannot read organizations or members, so they are refused.
 *
 * Not covered, because Trigger.dev exposes no API for them: per-member 2FA status and
 * session length. Record those as manual evidence on the relevant tasks.
 *
 * Scoped to Trigger.dev Cloud. Self-hosted instances serve the same API from their own
 * origin and would need the origin to become a connection credential.
 *
 * API documentation: https://trigger.dev/docs/management/overview
 */

import type { IntegrationManifest } from '../../types';
import {
  adminAccessCheck,
  appAvailabilityCheck,
  emailDomainsCheck,
  employeeAccessCheck,
  environmentSeparationCheck,
  pendingInvitesCheck,
} from './checks';
import { TRIGGER_API_URL, TRIGGER_TOKENS_URL } from './client';

export const triggerDevManifest: IntegrationManifest = {
  // Matches the catalog slug so this code manifest supersedes the dynamic definition.
  id: 'trigger-dev',
  name: 'Trigger.dev',
  description:
    'Review Trigger.dev member access, admin privileges, environment separation and production availability',
  category: 'Development',
  logoUrl: 'https://img.logo.dev/trigger.dev?token=pk_AZatYxV5QDSfWpRDaBxzRQ',
  docsUrl: 'https://trigger.dev/docs/management/overview',
  isActive: true,

  baseUrl: TRIGGER_API_URL,
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
      setupInstructions: `1. Log in to Trigger.dev with an account that has the Admin role in your organization
2. Open Account > Personal Access Tokens (${TRIGGER_TOKENS_URL})
3. Click "Create new token" and name it "Dilligent"
4. Copy the token (it starts with tr_pat_ and is shown once) and paste it below

A Personal Access Token is required: environment secret keys (tr_prod_..., tr_stg_...) only reach one environment and cannot read members or projects.

The token carries the access of the account that created it, so prefer a dedicated service account — a personal token stops working when that person is offboarded.`,
    },
  },

  credentialFields: [
    {
      id: 'api_key',
      label: 'Personal Access Token',
      type: 'password',
      required: true,
      placeholder: 'tr_pat_...',
      helpText: 'Trigger.dev > Account > Personal Access Tokens > Create new token',
    },
  ],

  capabilities: ['checks'],
  supportsMultipleConnections: false,

  checks: [
    employeeAccessCheck,
    adminAccessCheck,
    pendingInvitesCheck,
    emailDomainsCheck,
    environmentSeparationCheck,
    appAvailabilityCheck,
  ],
};

export default triggerDevManifest;
export * from './types';
