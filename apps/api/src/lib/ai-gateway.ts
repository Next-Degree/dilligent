import { createGatewayProvider } from '@ai-sdk/gateway';

/**
 * Shared Vercel AI Gateway provider for all model calls in the API.
 *
 * Model ids use the gateway's `provider/model` format. Auth comes from
 * `AI_GATEWAY_API_KEY` (or Vercel OIDC); `AI_GATEWAY_BASE_URL` is optional and
 * only needed to point at a non-default gateway.
 */
export const gateway = createGatewayProvider({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
});
