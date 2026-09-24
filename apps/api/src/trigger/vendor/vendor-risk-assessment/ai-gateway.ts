import { createGatewayProvider } from '@ai-sdk/gateway';

/**
 * Vercel AI Gateway provider for the vendor risk assessment task.
 *
 * Model calls go through the gateway rather than a provider SDK directly, so
 * they share the same credentials, spend limits, routing and observability as
 * the rest of the platform's AI usage. Auth comes from `AI_GATEWAY_API_KEY`
 * (or Vercel OIDC); `AI_GATEWAY_BASE_URL` is optional and only needed to point
 * at a non-default gateway.
 */
export const gateway = createGatewayProvider({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
});
