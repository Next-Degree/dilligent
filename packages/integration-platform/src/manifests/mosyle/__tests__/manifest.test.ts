import { describe, expect, it } from 'bun:test';
import { mosyleManifest } from '..';
import { getManifest, registry } from '../../../registry';

describe('mosyle manifest', () => {
  it('is registered as a code manifest so DB state can never override it', () => {
    expect(getManifest('mosyle')).toBe(mosyleManifest);
    expect(registry.isCodeManifest('mosyle')).toBe(true);
  });

  it('declares device_sync and ships a code-based runner', () => {
    expect(mosyleManifest.capabilities).toContain('device_sync');
    expect(typeof mosyleManifest.deviceSync).toBe('function');
  });

  it('is not a directory source — Mosyle knows enrolled Macs, not who works here', () => {
    expect(mosyleManifest.isDirectorySource).toBeUndefined();
  });

  it('collects every credential the Mosyle API requires', () => {
    const fields = mosyleManifest.auth.config.credentialFields as Array<{ id: string }>;
    expect(fields.map((field) => field.id)).toEqual([
      'environment',
      'access_token',
      'admin_email',
      'admin_password',
    ]);
  });

  it('exposes the checks the catalog advertises', () => {
    expect(mosyleManifest.checks?.map((check) => check.id)).toEqual([
      'device_list',
      'secure_devices',
    ]);
  });
});
