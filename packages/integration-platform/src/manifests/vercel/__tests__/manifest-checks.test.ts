import { describe, expect, it } from 'bun:test';
import { vercelManifest } from '../index';

/**
 * The security posture checks the Vercel integration is required to ship.
 *
 * Named here rather than derived from the manifest so that deleting or
 * renaming one fails CI: each name is what an auditor reads on the evidence
 * task, so a silent rename breaks the mapping between our findings and the
 * control they were collected for.
 */
const REQUIRED_CHECK_NAMES = [
  'Vercel bucket encrypted',
  'Vercel databases enforce SSL connection',
  'Vercel non-relational database encrypted',
  'Vercel relational database encrypted',
  'Vercel storage bucket secure access enabled',
  'Vercel unwanted traffic filter',
];

describe('vercelManifest checks', () => {
  const checks = vercelManifest.checks ?? [];

  for (const name of REQUIRED_CHECK_NAMES) {
    it(`ships "${name}"`, () => {
      const check = checks.find((candidate) => candidate.name === name);
      expect(check).toBeDefined();
      // A check without a task mapping collects evidence nothing consumes.
      expect(check?.taskMapping).toBeDefined();
      expect(check?.defaultSeverity).toBeDefined();
    });
  }

  it('keeps check ids unique', () => {
    const ids = checks.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps check names unique', () => {
    const names = checks.map((check) => check.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
