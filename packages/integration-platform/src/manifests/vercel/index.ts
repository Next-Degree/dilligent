import type { IntegrationManifest } from '../../types';
import {
  accountDeprovisioningCheck,
  accountInventoryCheck,
  appAvailabilityCheck,
  bucketEncryptedCheck,
  databasesEnforceSslCheck,
  firewallCheck,
  monitoringAlertingCheck,
  nonRelationalDatabaseEncryptedCheck,
  relationalDatabaseEncryptedCheck,
  storageBucketSecureAccessCheck,
  trafficFilterCheck,
} from './checks';

export const vercelManifest: IntegrationManifest = {
  id: 'vercel',
  name: 'Vercel',
  description:
    'Monitor deployments, team access, storage posture and firewall configuration in Vercel',
  category: 'Cloud',
  logoUrl: 'https://img.logo.dev/vercel.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ&format=png&retina=true',
  docsUrl: 'https://vercel.com/docs/rest-api',
  isActive: true,

  auth: {
    type: 'api_key',
    config: {
      in: 'header',
      name: 'Authorization',
      prefix: 'Bearer ',
      setupInstructions: `1. In Vercel, open [Account Settings → Tokens](https://vercel.com/account/tokens)
2. Click **Create Token** and name it "Dilligent"
3. Under **Scope**, select the **team** you want reviewed — not your personal account
4. Set an expiration you are willing to rotate on, then create it
5. Copy the token (it is shown once) and paste it below

The team is read from the token, so there is nothing else to enter. Scoping the token to one team also settles which team that is: a token scoped to your personal account can see every team you belong to, and the checks will ask you to narrow it rather than guess which one to report on.

The token inherits the access of the account that created it, so prefer a service account over a personal one — a personal token stops working when that person is offboarded, which would silently blind the offboarding check itself.

Why a token rather than an OAuth install: Vercel grants integration tokens a fixed set of endpoints, which excludes the firewall API entirely, and scopes the rest in ways that made team reads unreliable. A team-scoped access token reaches everything these checks need.`,
    },
  },

  credentialFields: [
    {
      id: 'api_key',
      label: 'Vercel Access Token',
      type: 'password',
      required: true,
      placeholder: 'vcp_...',
      helpText:
        'Vercel > Account Settings > Tokens > Create Token, scoped to the team you want reviewed.',
    },
  ],

  baseUrl: 'https://api.vercel.com',

  capabilities: ['checks'],

  services: [
    {
      id: 'monitoring',
      name: 'Monitoring & Alerting',
      description: 'Deployment monitoring and alerting configuration checks',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'access',
      name: 'Access & Identity',
      description: 'Team account attribution and offboarding coverage checks',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'security',
      name: 'Security Settings',
      description: 'Project firewall (WAF) and unwanted-traffic filtering audit',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'storage',
      name: 'Storage & Databases',
      description: 'Encryption, TLS and bucket access checks for Blob, database and KV stores',
      enabledByDefault: true,
      implemented: true,
    },
  ],

  checks: [
    monitoringAlertingCheck,
    appAvailabilityCheck,
    accountInventoryCheck,
    accountDeprovisioningCheck,
    firewallCheck,
    trafficFilterCheck,
    bucketEncryptedCheck,
    storageBucketSecureAccessCheck,
    relationalDatabaseEncryptedCheck,
    nonRelationalDatabaseEncryptedCheck,
    databasesEnforceSslCheck,
  ],
};
