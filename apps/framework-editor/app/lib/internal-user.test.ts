import { describe, expect, it } from 'vitest';
import { isInternalUser } from './internal-user';

describe('isInternalUser', () => {
  it('accepts addresses on the internal domain', () => {
    expect(isInternalUser('someone@trycomp.ai')).toBe(true);
  });

  it('rejects other domains, subdomains and malformed addresses', () => {
    expect(isInternalUser('someone@gmail.com')).toBe(false);
    expect(isInternalUser('someone@evil.trycomp.ai.com')).toBe(false);
    expect(isInternalUser('someone@trycomp.ai@gmail.com')).toBe(false);
    expect(isInternalUser('someone')).toBe(false);
  });
});
