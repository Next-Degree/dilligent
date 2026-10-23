import { loadRunCredentials } from './run-credentials';

describe('loadRunCredentials', () => {
  it('returns an empty set for credential-less integrations without reading the vault', async () => {
    const load = jest.fn();

    await expect(
      loadRunCredentials({ authType: 'none', load }),
    ).resolves.toEqual({});
    expect(load).not.toHaveBeenCalled();
  });

  it('returns the stored credentials for every other auth type', async () => {
    const load = jest.fn().mockResolvedValue({ api_key: 'k' });

    await expect(
      loadRunCredentials({ authType: 'api_key', load }),
    ).resolves.toEqual({ api_key: 'k' });
  });

  it('keeps a missing credential set as null so callers still reject it', async () => {
    const load = jest.fn().mockResolvedValue(null);

    await expect(
      loadRunCredentials({ authType: 'custom', load }),
    ).resolves.toBeNull();
    await expect(
      loadRunCredentials({ authType: undefined, load }),
    ).resolves.toBeNull();
  });
});
