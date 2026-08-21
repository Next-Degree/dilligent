import { describe, expect, it } from 'bun:test';
import { getAllManifests, getManifest } from '../../../registry';
import { manifest as githubManifest } from '../../github';
import { githubAppManifest } from '../index';

/**
 * CS-710: the new `github-app` integration must request read-only, fine-grained
 * access (a GitHub App via the standard OAuth authorize flow) while leaving the
 * legacy `github` OAuth integration completely untouched so existing connections
 * keep working.
 */
describe('github-app manifest (CS-710)', () => {
  it('is registered in the registry', () => {
    expect(getManifest('github-app')).toBeDefined();
    expect(getAllManifests().some((m) => m.id === 'github-app')).toBe(true);
  });

  it('uses the standard OAuth authorize flow with no `repo` scope (read-only via the App)', () => {
    const { auth } = githubAppManifest;
    expect(auth.type).toBe('oauth2');
    if (auth.type !== 'oauth2') return;
    // GitHub Apps ignore scopes — permissions come from the App config.
    expect(auth.config.scopes).toEqual([]);
    expect(auth.config.authorizeUrl).toBe('https://github.com/login/oauth/authorize');
    expect(auth.config.tokenUrl).toBe('https://github.com/login/oauth/access_token');
  });

  it('reuses the exact same checks as the legacy github manifest', () => {
    const appCheckIds = githubAppManifest.checks?.map((c) => c.id).sort();
    const legacyCheckIds = githubManifest.checks?.map((c) => c.id).sort();
    expect(appCheckIds).toEqual(legacyCheckIds);
    // Spelled out rather than counted, so adding a check to one manifest and
    // forgetting the other fails with the missing id rather than a bare number.
    expect(appCheckIds).toEqual([
      'branch_protection',
      'branch_protection_admin_enforcement',
      'code_scanning',
      'dependabot_enabled',
      'github_accounts_associated',
      'github_accounts_deprovisioned',
      'pr_author_not_reviewer',
      'repository_visibility_private',
      'sanitized_inputs',
      'two_factor_auth',
    ]);
  });

  it('shares the same check objects, so the two manifests cannot drift', () => {
    for (const legacyCheck of githubManifest.checks ?? []) {
      const appCheck = githubAppManifest.checks?.find((c) => c.id === legacyCheck.id);
      expect(appCheck).toBe(legacyCheck);
    }
  });

  it('declares a service for every check', () => {
    const serviceIds = new Set(githubAppManifest.services?.map((s) => s.id));
    for (const check of githubAppManifest.checks ?? []) {
      expect(serviceIds.has(check.service ?? '')).toBe(true);
    }
  });

  it('leaves the legacy github manifest untouched (still OAuth `repo` scope)', () => {
    expect(githubManifest.id).toBe('github');
    expect(githubManifest.name).toBe('GitHub');
    if (githubManifest.auth.type !== 'oauth2') {
      throw new Error('expected oauth2 auth');
    }
    expect(githubManifest.auth.config.scopes).toContain('repo');
  });
});
