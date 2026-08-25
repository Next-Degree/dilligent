/**
 * Auth client for browser-side authentication.
 *
 * Points directly at the NestJS API where better-auth runs.
 * Cross-subdomain cookies (.withpickle.dev) handle session sharing.
 */
import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export const authClient = createAuthClient({
  baseURL: BASE_URL,
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;
