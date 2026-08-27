import type { IntegrationManifest } from '../../types';
import {
  accountDeprovisioningCheck,
  accountInventoryCheck,
  appAvailabilityCheck,
  firewallCheck,
  monitoringAlertingCheck,
} from './checks';

export const vercelManifest: IntegrationManifest = {
  id: 'vercel',
  name: 'Vercel',
  description: 'Monitor deployments, team access and firewall configuration in Vercel',
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
3. Under **Scope**, select your **team** — not your personal account
4. Set an expiration you are willing to rotate on, then create it
5. Copy the token (it is shown once) and paste it below
6. Find your Team ID in **Team Settings → General → Team ID** (\`team_...\`) and paste that too

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
      helpText: 'Vercel > Account Settings > Tokens > Create Token, scoped to your team.',
    },
    {
      id: 'team_id',
      label: 'Vercel Team ID',
      type: 'text',
      required: true,
      placeholder: 'team_...',
      helpText:
        "Vercel > Team Settings > General > Team ID. Every check scopes its requests to this team; without it Vercel answers in the token owner's personal scope and returns nothing.",
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
      description: 'Project firewall (WAF) configuration audit',
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
  ],
};
