/**
 * Railway Integration Manifest
 *
 * Railway is a deployment platform for apps and databases. These checks read
 * Railway's GraphQL API with a customer workspace token and evidence: 2FA
 * across workspace members, TLS on public domains, employee access and
 * production availability.
 *
 * API documentation: https://docs.railway.com/integrations/api
 */

import type { IntegrationManifest } from '../../types';
import {
  appAvailabilityCheck,
  employeeAccessCheck,
  tlsDomainsCheck,
  twoFactorCheck,
} from './checks';

export const railwayManifest: IntegrationManifest = {
  id: 'railway',
  name: 'Railway',
  description:
    'Monitor Railway workspaces for 2FA, TLS on public domains, employee access and production availability.',
  category: 'Cloud',
  logoUrl:
    'https://img.logo.dev/railway.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ&format=png&retina=true',
  docsUrl: 'https://docs.railway.com/integrations/api',
  aliases: ['railway app', 'railway.app'],
  isActive: true,

  baseUrl: 'https://backboard.railway.com',
  // Not the runtime's default `${baseUrl}/graphql`, which 404s on Railway.
  graphqlEndpoint: 'https://backboard.railway.com/graphql/v2',
  defaultHeaders: {
    Accept: 'application/json',
  },

  auth: {
    type: 'api_key',
    config: {
      in: 'header',
      name: 'Authorization',
      prefix: 'Bearer ',
      setupInstructions: `1. In Railway, open [Account Settings → Tokens](https://railway.com/account/tokens)
2. Enter a name such as "Dilligent"
3. Under **Workspace**, select the workspace you want reviewed, then create the token
4. Copy the token and paste it below

Create the token from a **workspace admin** account: member 2FA status is only visible to admins, and a non-admin token would leave every member reported as "unknown".

A workspace token only sees that workspace, which is what you want reviewed. An account token ("No workspace") also works and covers every workspace the account belongs to, including personal ones. Project tokens do not work: they cannot read workspace members.

The checks only run queries; they never change anything in Railway.`,
    },
  },

  credentialFields: [
    {
      id: 'api_key',
      label: 'Railway Token',
      type: 'password',
      required: true,
      helpText:
        'Railway > Account Settings > Tokens > Create, scoped to the workspace you want reviewed.',
    },
  ],

  capabilities: ['checks'],
  supportsMultipleConnections: false,

  services: [
    {
      id: 'access',
      name: 'Access & Identity',
      description: 'Two-factor authentication and employee access across workspace members',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'security',
      name: 'Encryption in Transit',
      description: 'TLS certificates on public domains',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'inventory',
      name: 'Availability',
      description: 'Live deployments for production services',
      enabledByDefault: true,
      implemented: true,
    },
  ],

  checks: [twoFactorCheck, tlsDomainsCheck, employeeAccessCheck, appAvailabilityCheck],
};

export default railwayManifest;
export * from './types';
