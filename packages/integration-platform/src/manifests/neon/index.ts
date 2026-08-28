/**
 * Neon Integration Manifest
 *
 * Neon is serverless Postgres. These checks read the Neon API with a customer
 * API key and evidence the database tier of a compliance program: encryption,
 * TLS on connections, audit logging, retention, backups and organization MFA.
 *
 * API documentation: https://api-docs.neon.tech/reference/getting-started-with-neon-api
 */

import type { IntegrationManifest } from '../../types';
import {
  appAvailabilityCheck,
  auditLogsEnabledCheck,
  bucketEncryptionCheck,
  dailyBackupsCheck,
  databaseEncryptionCheck,
  infrastructureInventoryCheck,
  logRetentionCheck,
  mfaCheck,
  sslConnectionsCheck,
} from './checks';

export const neonManifest: IntegrationManifest = {
  id: 'neon',
  name: 'Neon',
  description:
    'Monitor Neon serverless Postgres projects for encryption, TLS, audit logging, retention, backups and organization MFA.',
  category: 'Cloud',
  logoUrl: 'https://img.logo.dev/neon.tech?token=pk_AZatYxV5QDSfWpRDaBxzRQ&format=png&retina=true',
  docsUrl: 'https://api-docs.neon.tech/reference/getting-started-with-neon-api',
  aliases: ['neondb', 'neon database', 'neon postgres'],
  isActive: true,

  // Trailing slash is load-bearing: ctx.fetch resolves paths with `new URL`,
  // so an absolute path would drop the `/api/v2` prefix. Check paths are
  // relative ("projects", not "/projects") for the same reason.
  baseUrl: 'https://console.neon.tech/api/v2/',
  defaultHeaders: {
    Accept: 'application/json',
  },

  auth: {
    type: 'api_key',
    config: {
      in: 'header',
      name: 'Authorization',
      prefix: 'Bearer ',
      setupInstructions: `1. In Neon, open **Organization settings → API keys**
2. Click **Create new API key** and name it "Dilligent"
3. Copy the key (it is shown once) and paste it below

Create an **organization** API key, not a personal one. The member list behind the MFA check is an organization resource, and an organization key also sees every project the organization owns — a personal key only sees projects you created, so projects owned by teammates would silently fall outside every check.

The key inherits the access of the account that creates it, so an admin should create it from the organization rather than from a personal account that stops working when that person is offboarded.

The key is read-only for everything these checks do: they only issue GET requests.`,
    },
  },

  credentialFields: [
    {
      id: 'api_key',
      label: 'Neon API Key',
      type: 'password',
      required: true,
      placeholder: 'napi_...',
      helpText: 'Neon Console > Organization settings > API keys > Create new API key.',
    },
  ],

  capabilities: ['checks'],

  services: [
    {
      id: 'security',
      name: 'Encryption & Transport',
      description: 'Encryption at rest for database and object storage, and TLS on connections',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'logging',
      name: 'Audit Logging & Retention',
      description: 'Audit log configuration and how long Neon retains recoverable history',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'backups',
      name: 'Backups',
      description: 'Scheduled snapshot coverage for each project',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'access',
      name: 'Access & Identity',
      description: 'Two-factor authentication across Neon organization members',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'inventory',
      name: 'Inventory & Availability',
      description: 'Project inventory and compute availability',
      enabledByDefault: true,
      implemented: true,
    },
  ],

  checks: [
    bucketEncryptionCheck,
    databaseEncryptionCheck,
    auditLogsEnabledCheck,
    sslConnectionsCheck,
    mfaCheck,
    logRetentionCheck,
    dailyBackupsCheck,
    infrastructureInventoryCheck,
    appAvailabilityCheck,
  ],
};

export default neonManifest;
export * from './types';
