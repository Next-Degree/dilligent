import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldAdHocSign, adHocSign } = require('./adhoc-sign.js');

describe('shouldAdHocSign', () => {
  it('signs a darwin build on a mac host with no certificate', () => {
    expect(shouldAdHocSign({ electronPlatformName: 'darwin', platform: 'darwin', env: {} })).toBe(true);
  });

  it('treats an empty CSC_LINK as no certificate', () => {
    expect(
      shouldAdHocSign({ electronPlatformName: 'darwin', platform: 'darwin', env: { CSC_LINK: '' } }),
    ).toBe(true);
  });

  it('leaves signing to electron-builder when a certificate is configured', () => {
    expect(
      shouldAdHocSign({ electronPlatformName: 'darwin', platform: 'darwin', env: { CSC_LINK: 'abc' } }),
    ).toBe(false);
  });

  it('skips non-mac targets', () => {
    expect(shouldAdHocSign({ electronPlatformName: 'win32', platform: 'darwin', env: {} })).toBe(false);
    expect(shouldAdHocSign({ electronPlatformName: 'linux', platform: 'darwin', env: {} })).toBe(false);
  });

  it('skips when the host cannot run codesign', () => {
    expect(shouldAdHocSign({ electronPlatformName: 'darwin', platform: 'linux', env: {} })).toBe(false);
  });
});

describe('adHocSign', () => {
  it('signs deeply with the ad-hoc identity, then verifies', () => {
    const exec = vi.fn();
    adHocSign({ appPath: '/out/App.app', exec });
    expect(exec.mock.calls).toEqual([
      ['codesign', ['--force', '--deep', '--sign', '-', '/out/App.app']],
      ['codesign', ['--verify', '--deep', '--strict', '/out/App.app']],
    ]);
  });

  it('propagates a verification failure so the build fails', () => {
    const exec = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => {
      throw new Error('invalid signature');
    });
    expect(() => adHocSign({ appPath: '/out/App.app', exec })).toThrow('invalid signature');
  });
});
