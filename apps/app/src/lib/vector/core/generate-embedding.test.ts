import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmbed, mockEmbeddingModel } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockEmbeddingModel: vi.fn((modelId: string) => ({ modelId })),
}));

vi.mock('@ai-sdk/gateway', () => ({
  createGatewayProvider: vi.fn(() => ({ embedding: mockEmbeddingModel })),
}));
vi.mock('ai', () => ({ embed: mockEmbed }));

import { EMBEDDING_MODEL, generateEmbedding } from './generate-embedding';

describe('generateEmbedding', () => {
  const originalKey = process.env.AI_GATEWAY_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_GATEWAY_API_KEY = 'test-key';
  });

  afterAll(() => {
    process.env.AI_GATEWAY_API_KEY = originalKey;
  });

  it('keeps the same OpenAI embedding model so stored vectors stay compatible', () => {
    expect(EMBEDDING_MODEL).toBe('openai/text-embedding-3-small');
  });

  it('generates the embedding through the AI Gateway', async () => {
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2] });

    await expect(generateEmbedding('hello')).resolves.toEqual([0.1, 0.2]);
    expect(mockEmbeddingModel).toHaveBeenCalledWith('openai/text-embedding-3-small');
    expect(mockEmbed).toHaveBeenCalledWith({
      model: { modelId: 'openai/text-embedding-3-small' },
      value: 'hello',
    });
  });

  it('fails clearly when the AI Gateway key is missing', async () => {
    delete process.env.AI_GATEWAY_API_KEY;

    await expect(generateEmbedding('hello')).rejects.toThrow(
      'AI_GATEWAY_API_KEY is not configured',
    );
    expect(mockEmbed).not.toHaveBeenCalled();
  });
});
