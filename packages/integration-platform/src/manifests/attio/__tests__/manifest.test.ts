import { describe, expect, it } from 'bun:test';
import { registry } from '../../../registry';
import { attioManifest } from '../index';

describe('attio manifest', () => {
  it('is registered in the registry as a code manifest', () => {
    expect(registry.getManifest('attio')).toBeDefined();
    // A code manifest can never be shadowed by the DB-backed definition of the same
    // slug, and — critically — its failures are reported plainly rather than held as
    // 'inconclusive' the way dynamic-provider runs are.
    expect(registry.isCodeManifest('attio')).toBe(true);
  });

  it('sends the API key as a Bearer token on the Authorization header', () => {
    expect(attioManifest.auth.type).toBe('api_key');
    if (attioManifest.auth.type !== 'api_key') throw new Error('unreachable');

    expect(attioManifest.auth.config.in).toBe('header');
    expect(attioManifest.auth.config.name).toBe('Authorization');
    // Attio accepts API keys and OAuth tokens through the same Bearer scheme.
    expect(attioManifest.auth.config.prefix).toBe('Bearer ');
  });

  it('tells the customer which scope the key needs', () => {
    if (attioManifest.auth.type !== 'api_key') throw new Error('unreachable');
    // Without user_management:read the member list 403s, which is the single most
    // likely setup mistake, so the connect form has to call it out.
    expect(attioManifest.auth.config.setupInstructions).toContain('User management');
  });

  it('exposes an api_key credential field the runtime can read', () => {
    // buildHeaders falls back to the `api_key` credential when the header name is
    // not itself a credential key, so this id is load-bearing, not cosmetic.
    expect(attioManifest.credentialFields?.map((field) => field.id)).toContain('api_key');
  });

  it('points ctx.fetch at the Attio API', () => {
    expect(attioManifest.baseUrl).toBe('https://api.attio.com');
  });

  it('ships membership and 2FA checks, keeping the slugs the catalog already lists', () => {
    const ids = attioManifest.checks?.map((check) => check.id) ?? [];
    // attio_employee_access and attio_access_review were already live as a dynamic
    // integration; reusing the slugs keeps their existing results attached.
    expect(ids).toEqual(['attio_employee_access', 'attio_two_factor_auth', 'attio_access_review']);
  });

  it('maps every check to a compliance task', () => {
    for (const check of attioManifest.checks ?? []) {
      expect(check.taskMapping).toBeTruthy();
    }
  });

  it('declares the services its checks are grouped under', () => {
    const serviceIds = new Set(attioManifest.services?.map((service) => service.id));
    for (const check of attioManifest.checks ?? []) {
      expect(serviceIds.has(check.service ?? '')).toBe(true);
    }
  });
});
