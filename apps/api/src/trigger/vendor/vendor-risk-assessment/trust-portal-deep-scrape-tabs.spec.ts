import { identifySidebarTabs } from './trust-portal-deep-scrape-tabs';

jest.mock('@trigger.dev/sdk', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const gatewayModelMock = jest.fn((modelId: string) => `gateway:${modelId}`);
jest.mock('@ai-sdk/gateway', () => ({
  createGatewayProvider: () => (modelId: string) => gatewayModelMock(modelId),
}));

const generateObjectMock = jest.fn();
jest.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

describe('identifySidebarTabs', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
    gatewayModelMock.mockClear();
  });

  it('resolves the model through the Vercel AI Gateway', async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { tabLabels: ['Cloud Security'] },
    });

    await identifySidebarTabs({
      vendorName: 'Ubiquiti',
      initialMarkdown: '# Trust center\nCloud Security',
    });

    expect(gatewayModelMock).toHaveBeenCalledWith('anthropic/claude-sonnet-4-6');
    expect(generateObjectMock.mock.calls[0][0].model).toBe(
      'gateway:anthropic/claude-sonnet-4-6',
    );
  });

  it('dedupes, trims and drops overlong labels', async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        tabLabels: [
          '  Cloud Security ',
          'Cloud Security',
          '',
          'x'.repeat(61),
          'Subprocessors',
        ],
      },
    });

    const result = await identifySidebarTabs({
      vendorName: 'Acme',
      initialMarkdown: '# Trust',
    });

    expect(result).toEqual(['Cloud Security', 'Subprocessors']);
  });

  it('returns an empty array without calling the model when markdown is blank', async () => {
    const result = await identifySidebarTabs({
      vendorName: 'Acme',
      initialMarkdown: '   ',
    });

    expect(result).toEqual([]);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('returns an empty array when the gateway call fails', async () => {
    generateObjectMock.mockRejectedValueOnce(new Error('gateway unavailable'));

    const result = await identifySidebarTabs({
      vendorName: 'Acme',
      initialMarkdown: '# Trust',
    });

    expect(result).toEqual([]);
  });
});
