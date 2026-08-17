import { afterEach, describe, expect, it, vi } from 'vitest';

import { isWebAutomationsFeatureEnabled } from './web-automations-feature';

describe('isWebAutomationsFeatureEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns true when the PostHog flag is true', () => {
    expect(isWebAutomationsFeatureEnabled({ 'is-web-automations-enabled': true })).toBe(true);
  });

  it('returns true when the flag is the string "true" (multivariate variant)', () => {
    expect(isWebAutomationsFeatureEnabled({ 'is-web-automations-enabled': 'true' })).toBe(true);
  });

  it('returns false when the flag is missing (e.g. PostHog not configured)', () => {
    expect(isWebAutomationsFeatureEnabled({})).toBe(false);
  });

  it('returns false when the flag is false', () => {
    expect(isWebAutomationsFeatureEnabled({ 'is-web-automations-enabled': false })).toBe(false);
  });

  it('returns false for a variant that is not "true"', () => {
    expect(isWebAutomationsFeatureEnabled({ 'is-web-automations-enabled': 'control' })).toBe(false);
  });

  it('force-enables via ENABLE_WEB_AUTOMATIONS=true even when the flag is off', () => {
    vi.stubEnv('ENABLE_WEB_AUTOMATIONS', 'true');
    expect(isWebAutomationsFeatureEnabled({})).toBe(true);
    expect(isWebAutomationsFeatureEnabled({ 'is-web-automations-enabled': false })).toBe(true);
  });

  it('ignores non-"true" values of the env override', () => {
    vi.stubEnv('ENABLE_WEB_AUTOMATIONS', '1');
    expect(isWebAutomationsFeatureEnabled({})).toBe(false);
  });
});
