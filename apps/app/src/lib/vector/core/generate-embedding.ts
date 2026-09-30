import 'server-only';

import { createGatewayProvider } from '@ai-sdk/gateway';
import { embed } from 'ai';

// Routed through the Vercel AI Gateway. Same OpenAI model as before, so
// vectors already stored in the index stay compatible. Must match
// EMBEDDING_MODEL in apps/api/src/vector-store/lib/core/generate-embedding.ts
// (same index).
const gateway = createGatewayProvider({
  baseURL: process.env.AI_GATEWAY_BASE_URL,
});

export const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

/**
 * Generates an embedding vector for the given text via the AI Gateway
 * @param text - The text to generate an embedding for
 * @returns An array of numbers representing the embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const { embedding } = await embed({
      model: gateway.embedding(EMBEDDING_MODEL),
      value: text,
    });

    return embedding;
  } catch (error) {
    throw new Error(
      `Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
