import { createGatewayProvider } from '@ai-sdk/gateway';

/**
 * Vercel AI Gateway provider for questionnaire parsing, extraction and
 * answer generation.
 *
 * Auth comes from `AI_GATEWAY_API_KEY` (or Vercel OIDC); `AI_GATEWAY_BASE_URL`
 * is optional and only needed to point at a non-default gateway.
 */
export const gateway = createGatewayProvider({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
});
