import { describe, expect, it } from 'vitest';
import { isInternalUser } from './internal-user';

describe('isInternalUser', () => {
  it('accepts addresses on the internal domain', () => {
    expect(isInternalUser('someone@nextdegree.org')).toBe(true);
  });

  it('rejects other domains, subdomains and malformed addresses', () => {
    expect(isInternalUser('someone@gmail.com')).toBe(false);
    expect(isInternalUser('someone@trycomp.ai')).toBe(false);
    expect(isInternalUser('someone@evil.nextdegree.org.com')).toBe(false);
    expect(isInternalUser('someone@nextdegree.org@gmail.com')).toBe(false);
    expect(isInternalUser('someone')).toBe(false);
  });
});
