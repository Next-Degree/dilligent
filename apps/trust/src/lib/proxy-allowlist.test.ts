import { describe, expect, it } from 'vitest';
import { isAllowedProxyCall } from './proxy-allowlist';

const allowed = (method: string, path: string) =>
  isAllowedProxyCall({ method, segments: path.split('/') });

describe('isAllowedProxyCall', () => {
  it.each([
    ['POST', 'acme/requests'],
    ['POST', 'acme/reclaim'],
    ['POST', 'nda/tok/sign'],
    ['POST', 'nda/tok/preview-nda'],
    ['GET', 'access/tok/policies/download-all'],
    ['GET', 'access/tok/policies/pol_1/download'],
    ['GET', 'access/tok/documents/download-all'],
    ['GET', 'access/tok/documents/doc_1'],
    ['GET', 'access/tok/compliance-resources/iso_27001'],
    ['GET', 'access/tok/compliance-resources/custom/cfrm_1'],
  ])('allows %s %s', (method, path) => {
    expect(allowed(method, path)).toBe(true);
  });

  it.each([
    ['GET', 'admin/requests'],
    ['POST', 'admin/requests/req_1/approve'],
    ['POST', 'admin/grants/g_1/revoke'],
    ['POST', 'admin/requests'],
    ['GET', 'acme/requests'],
    ['DELETE', 'acme/requests'],
    ['POST', 'acme/faqs'],
    ['POST', 'access/requests'],
    ['POST', 'nda/requests'],
    ['GET', 'access/tok/policies'],
    ['GET', 'access/tok/documents/../admin'],
  ])('rejects %s %s', (method, path) => {
    expect(allowed(method, path)).toBe(false);
  });
});
