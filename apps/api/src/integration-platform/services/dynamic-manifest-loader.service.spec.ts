jest.mock('@db', () => {
  class PrismaClientInitializationError extends Error {}
  class PrismaClientKnownRequestError extends Error {
    code = '';
  }
  return {
    db: {},
    Prisma: { PrismaClientInitializationError, PrismaClientKnownRequestError },
  };
});
jest.mock('@trycompai/integration-platform', () => ({
  registry: { refreshDynamic: jest.fn() },
  interpretDeclarativeCheck: jest.fn(),
}));

import { DynamicManifestLoaderService } from './dynamic-manifest-loader.service';
import type { DynamicIntegrationRepository } from '../repositories/dynamic-integration.repository';

describe('DynamicManifestLoaderService', () => {
  let findActive: jest.Mock;
  let service: DynamicManifestLoaderService;

  beforeEach(() => {
    jest.useFakeTimers();
    findActive = jest.fn().mockResolvedValue([]);
    const repo = { findActive } as unknown as DynamicIntegrationRepository;
    service = new DynamicManifestLoaderService(repo);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('does not poll after a successful boot load', async () => {
    await service.onModuleInit();
    expect(findActive).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(findActive).toHaveBeenCalledTimes(1);
  });

  it('retries a failed boot load until it succeeds, then stops', async () => {
    findActive
      .mockRejectedValueOnce(new Error("Can't reach database server"))
      .mockRejectedValueOnce(new Error("Can't reach database server"))
      .mockResolvedValue([]);

    await service.onModuleInit();
    expect(findActive).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(findActive).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(findActive).toHaveBeenCalledTimes(3);

    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(findActive).toHaveBeenCalledTimes(3);
  });

  it('still reloads on demand via invalidateCache', async () => {
    await service.onModuleInit();
    await service.invalidateCache();
    expect(findActive).toHaveBeenCalledTimes(2);
  });
});
