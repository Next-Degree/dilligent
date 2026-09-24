/**
 * Mosyle Integration Manifest
 *
 * Mosyle is an Apple-only MDM. This integration pulls the managed Mac fleet
 * into Comp AI's device inventory and evidences device management for
 * compliance checks.
 *
 * The API reference is published inside each customer's own console under
 * Organization > API Integration; `client.ts` documents the shapes this
 * integration relies on and probes for version differences.
 */

import type { IntegrationManifest } from '../../types';
import { deviceListCheck, secureDevicesCheck } from './checks';
import { runDeviceSync } from './device-sync';

export const mosyleManifest: IntegrationManifest = {
  id: 'mosyle',
  name: 'Mosyle',
  description:
    'Apple Mobile Device Management (MDM) for iPads, iPhones, Macs, and Apple TVs. Syncs managed Macs into your device inventory.',
  category: 'Security',
  logoUrl: 'https://img.logo.dev/mosyle.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ',
  docsUrl: 'https://docs.trycomp.ai/integrations/mosyle',

  // Mosyle runs two products on two hosts (businessapi/managerapi), so every
  // request passes an explicit baseUrl resolved from the connection's
  // environment credential rather than a manifest-level one.
  defaultHeaders: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },

  auth: {
    type: 'custom',
    config: {
      description:
        'Mosyle authenticates with an API access token plus an admin login, which together obtain a JWT. Basic authentication is deprecated — the API profile must be set to JWT.',
      setupInstructions: `1. Log in to your Mosyle admin console
2. Go to Organization > API Integration
3. Enable the API profile — the Access Token appears once it is enabled
4. If the profile still uses Basic Authentication, create a new API token so it uses JWT
5. Copy the Access Token
6. Enter it below along with the email and password of an admin user with device-read access`,
      credentialFields: [
        {
          id: 'environment',
          label: 'Mosyle Environment',
          type: 'select',
          required: true,
          helpText: 'Which Mosyle product your organization uses',
          options: [
            { value: 'business', label: 'Mosyle Business' },
            { value: 'manager', label: 'Mosyle Manager (Education)' },
          ],
        },
        {
          id: 'access_token',
          label: 'Access Token',
          type: 'password',
          required: true,
          helpText: 'API access token from Organization > API Integration',
        },
        {
          id: 'admin_email',
          label: 'Admin Email',
          type: 'text',
          required: true,
          helpText: 'Email address of an admin user for API authentication',
        },
        {
          id: 'admin_password',
          label: 'Admin Password',
          type: 'password',
          required: true,
          helpText: 'Password for the admin user account',
        },
      ],
    },
  },

  capabilities: ['checks', 'device_sync'],

  // Mosyle knows which Macs are enrolled, not who works here — device sync
  // never deactivates members.
  deviceSync: runDeviceSync,

  services: [
    {
      id: 'device-inventory',
      name: 'Device Inventory',
      description: 'Import managed Macs into the device list',
      enabledByDefault: true,
      implemented: true,
    },
    {
      id: 'device-compliance',
      name: 'Device Compliance',
      description: 'Encryption, supervision, and platform security signals',
      enabledByDefault: true,
      implemented: true,
    },
  ],

  checks: [deviceListCheck, secureDevicesCheck],

  supportsMultipleConnections: false,
  isActive: true,
};

export default mosyleManifest;
export * from './types';
