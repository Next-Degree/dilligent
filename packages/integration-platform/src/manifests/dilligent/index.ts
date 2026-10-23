/**
 * Dilligent Integration Manifest
 *
 * A built-in integration whose checks evidence Dilligent's own records rather
 * than a third-party API. It holds no credentials: the host that runs the
 * checks supplies the data through `CheckContext.training`. Connecting it is
 * the organization's opt-in to having those checks drive their mapped tasks.
 */

import type { IntegrationManifest } from '../../types';
import { securityAwarenessTrainingCheck } from './checks';

export const dilligentManifest: IntegrationManifest = {
  id: 'dilligent',
  name: 'Dilligent',
  description:
    'Evidence security awareness training completion from the Dilligent employee portal.',
  category: 'HR & People',
  logoUrl: '/apple-touch-icon.png',
  isActive: true,

  auth: {
    type: 'none',
    config: {
      setupInstructions: `No credentials are needed: the checks read training completions that employees record in the Dilligent employee portal.

Connecting turns the checks on. They run daily and set the Security Awareness Training task to done when every person required to take the training has finished it within the last year. People who joined in the last 30 days pass while they are still inside their onboarding window.`,
    },
  },

  capabilities: ['checks'],
  supportsMultipleConnections: false,

  services: [
    {
      id: 'people',
      name: 'People',
      description: 'Security awareness training completion across your people',
      enabledByDefault: true,
      implemented: true,
    },
  ],

  checks: [securityAwarenessTrainingCheck],
};

export default dilligentManifest;
