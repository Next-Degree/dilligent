/**
 * Linear Integration Manifest
 *
 * Linear is a project and issue tracker. Its API is GraphQL-only — one endpoint at
 * POST https://api.linear.app/graphql — so the checks use `ctx.graphql` rather than
 * `ctx.fetch`: it throws on the `errors[]` array Linear returns with HTTP 200, which
 * a plain REST call would silently treat as success.
 *
 * API Documentation: https://developers.linear.app/docs
 */

import type { IntegrationManifest } from '../../types';
import { employeeAccessCheck } from './checks';

export const linearManifest: IntegrationManifest = {
  id: 'linear',
  name: 'Linear',
  description: 'Linear project and issue tracking for software teams',
  category: 'Development',
  logoUrl: 'https://img.logo.dev/linear.app?token=pk_AZatYxV5QDSfWpRDaBxzRQ',
  docsUrl: 'https://developers.linear.app/docs',
  isActive: true,

  baseUrl: 'https://api.linear.app',
  defaultHeaders: {
    'Content-Type': 'application/json',
  },

  /**
   * The public catalog lists Linear as `custom`, but `api_key` is the better fit here:
   * the runtime's `buildHeaders` injects auth automatically for oauth2/api_key/basic and
   * does nothing for `custom`, which would mean setting an Authorization header by hand
   * on every request. Linear personal API keys are sent raw, so there is no prefix —
   * only its OAuth tokens use `Bearer`.
   */
  auth: {
    type: 'api_key',
    config: {
      in: 'header',
      name: 'Authorization',
      setupInstructions: `1. Log in to Linear
2. Go to Settings > Account > Security & Access (or visit https://linear.app/settings/account/security)
3. Under Personal API keys, click Create key
4. Paste the key below

The key inherits the permissions of the account that created it, so prefer a service account over a personal one — a personal key stops working when that person is offboarded.`,
    },
  },

  credentialFields: [
    {
      id: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'lin_api_...',
      helpText: 'Linear > Settings > Account > Security & Access > Personal API keys > Create key',
    },
  ],

  capabilities: ['checks'],
  supportsMultipleConnections: false,

  checks: [employeeAccessCheck],
};

export default linearManifest;
export * from './types';
