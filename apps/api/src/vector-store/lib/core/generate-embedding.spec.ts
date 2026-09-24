const mockEmbeddingModel = jest.fn((modelId: string) => ({ modelId }));
jest.mock('@ai-sdk/gateway', () => ({
  createGatewayProvider: jest.fn(() => ({ embedding: mockEmbeddingModel })),
}));
jest.mock('ai', () => ({
  embed: jest.fn(),
  embedMany: jest.fn(),
}));

import { embed, embedMany } from 'ai';
import {
  batchGenerateEmbeddings,
  EMBEDDING_MODEL,
  generateEmbedding,
} from './generate-embedding';

const mockEmbed = embed as jest.Mock;
const mockEmbedMany = embedMany as jest.Mock;

describe('generate-embedding', () => {
  const originalKey = process.env.AI_GATEWAY_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_GATEWAY_API_KEY = 'test-key';
  });

  afterAll(() => {
    process.env.AI_GATEWAY_API_KEY = originalKey;
  });

  it('keeps the same OpenAI embedding model so stored vectors stay compatible', () => {
    expect(EMBEDDING_MODEL).toBe('openai/text-embedding-3-small');
  });

  it('generates a single embedding through the AI Gateway', async () => {
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2] });

    await expect(generateEmbedding('hello')).resolves.toEqual([0.1, 0.2]);
    expect(mockEmbeddingModel).toHaveBeenCalledWith(
      'openai/text-embedding-3-small',
    );
    expect(mockEmbed).toHaveBeenCalledWith({
      model: { modelId: 'openai/text-embedding-3-small' },
      value: 'hello',
    });
  });

  it('maps batch embeddings back to their original positions', async () => {
    mockEmbedMany.mockResolvedValue({ embeddings: [[1], [2]] });

    await expect(batchGenerateEmbeddings(['a', ' ', 'b'])).resolves.toEqual([
      [1],
      [],
      [2],
    ]);
    expect(mockEmbedMany).toHaveBeenCalledWith({
      model: { modelId: 'openai/text-embedding-3-small' },
      values: ['a', 'b'],
    });
  });

  it('fails clearly when the AI Gateway key is missing', async () => {
    delete process.env.AI_GATEWAY_API_KEY;

    await expect(generateEmbedding('hello')).rejects.toThrow(
      'AI_GATEWAY_API_KEY is not configured',
    );
    await expect(batchGenerateEmbeddings(['hello'])).rejects.toThrow(
      'AI_GATEWAY_API_KEY is not configured',
    );
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockEmbedMany).not.toHaveBeenCalled();
  });
});
