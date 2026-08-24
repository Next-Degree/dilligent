import type { IntegrationManifest } from '../../types';
import {
  accountDeprovisioningCheck,
  accountInventoryCheck,
  appAvailabilityCheck,
  firewallCheck,
  monitoringAlertingCheck,
  twoFactorAuthCheck,
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
    type: 'oauth2',
    config: {
      authorizeUrl: 'https://vercel.com/integrations/{APP_SLUG}/new',
      tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
      scopes: [],
      pkce: false,
      clientAuthMethod: 'body',
      supportsRefreshToken: false,
      setupInstructions: `## Setting up Vercel OAuth

### Step 1: Create a Vercel App
1. Go to your [Vercel Team Settings → Apps](https://vercel.com/your-team/~/settings/apps)
2. Click **Create**
3. Fill in:
   - **Name**: Dilligent Security
   - **Redirect URL**: \`{CALLBACK_URL}\`
4. Click **Create**

### Step 2: Get Credentials
Copy the **Client ID** and **Client Secret** (click Reveal)

### Step 3: Configure in Admin
Enter the Client ID, Secret, and the integration slug (from \`vercel.com/integrations/{slug}\`) in the admin page.

> **Team Support**: When connecting, you'll choose whether to install for your personal account or a team. If you select a team, all API calls will be scoped to that team.`,
      additionalOAuthSettings: [
        {
          id: 'appSlug',
          label: 'Vercel Integration Slug',
          type: 'text',
          helpText:
            'The slug from your Vercel integration URL (https://vercel.com/integrations/{slug}). Used to launch the correct install page.',
          required: true,
          token: '{APP_SLUG}',
        },
      ],
    },
  },

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
      description:
        'Team account attribution, offboarding coverage and multi-factor authentication checks',
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
    twoFactorAuthCheck,
    firewallCheck,
  ],
};
