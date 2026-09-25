/**
 * Upstash Integration Manifest
 *
 * Upstash is serverless Redis (and Kafka). These checks read the Upstash
 * Developer API with a customer email + management API key and evidence the
 * database tier of a compliance program: TLS on connections, IP-allowlist
 * access control, and database availability.
 *
 * API documentation: https://upstash.com/docs/devops/developer-api/overview
 */

import type { IntegrationManifest } from '../../types';
import { appAvailabilityCheck, noPublicAccessCheck, tlsConnectionsCheck } from './checks';

export const upstashManifest: IntegrationManifest = {
  id: 'upstash',
  name: 'Upstash',
  description:
    'Monitor Upstash serverless Redis databases for TLS enforcement, IP-allowlist access control, and availability.',
  category: 'Cloud',
  logoUrl:
    'https://img.logo.dev/upstash.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ&format=png&retina=true',
  docsUrl: 'https://upstash.com/docs/devops/developer-api/overview',
  aliases: ['upstash redis', 'upstash kafka'],
  isActive: true,

  // Trailing slash is load-bearing: ctx.fetch resolves paths with `new URL`,
  // so an absolute path would drop the `/v2` prefix. Check paths are
  // relative ("redis/databases", not "/redis/databases") for the same reason.
  baseUrl: 'https://api.upstash.com/v2/',
  defaultHeaders: {
    Accept: 'application/json',
  },

  auth: {
    type: 'basic',
    config: {
      usernameField: 'email',
      passwordField: 'api_key',
    },
  },

  credentialFields: [
    {
      id: 'email',
      label: 'Upstash Account Email',
      type: 'text',
      required: true,
      placeholder: 'you@example.com',
      helpText: 'The email address you use to sign in to the Upstash Console.',
    },
    {
      id: 'api_key',
      label: 'Upstash API Key',
      type: 'password',
      required: true,
      helpText: 'Upstash Console > Account > Management API > Create API Key.',
    },
  ],

  capabilities: ['checks'],

  services: [
    {
      id: 'security',
      name: 'Encryption & Access Control',
      description: 'TLS enforcement on connections and IP-allowlist network access control',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'inventory',
      name: 'Inventory & Availability',
      description: 'Database inventory and availability',
      enabledByDefault: true,
      implemented: true,
    },
  ],

  checks: [tlsConnectionsCheck, noPublicAccessCheck, appAvailabilityCheck],
};

export default upstashManifest;
export * from './types';
