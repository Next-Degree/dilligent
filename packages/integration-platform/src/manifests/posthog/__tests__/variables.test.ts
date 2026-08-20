import { describe, expect, it } from 'bun:test';
import {
  filterOrganizations,
  parseAllowedEmailDomains,
  parseBooleanVariable,
  parseTargetOrganizations,
} from '../variables';

const orgs = [
  { id: 'org-a', name: 'Acme', slug: 'acme' },
  { id: 'org-b', name: 'Beta', slug: 'beta' },
];

describe('parseBooleanVariable', () => {
  it('reads real booleans', () => {
    expect(parseBooleanVariable({ flag: true }, 'flag', false)).toBe(true);
    expect(parseBooleanVariable({ flag: false }, 'flag', true)).toBe(false);
  });

  it('reads the string forms a stored variable comes back as', () => {
    expect(parseBooleanVariable({ flag: 'true' }, 'flag', false)).toBe(true);
    expect(parseBooleanVariable({ flag: 'FALSE' }, 'flag', true)).toBe(false);
    expect(parseBooleanVariable({ flag: 'yes' }, 'flag', false)).toBe(true);
    expect(parseBooleanVariable({ flag: '0' }, 'flag', true)).toBe(false);
  });

  it('falls back for unset and unrecognised values', () => {
    expect(parseBooleanVariable(undefined, 'flag', true)).toBe(true);
    expect(parseBooleanVariable({}, 'flag', false)).toBe(false);
    expect(parseBooleanVariable({ flag: 'maybe' }, 'flag', true)).toBe(true);
  });
});

describe('parseAllowedEmailDomains', () => {
  it('splits on commas, semicolons and whitespace', () => {
    expect([
      ...parseAllowedEmailDomains({ allowed_email_domains: 'acme.com, acme.io;acme.dev' }),
    ]).toEqual(['acme.com', 'acme.io', 'acme.dev']);
  });

  it('normalises the ways people actually type a domain', () => {
    expect([
      ...parseAllowedEmailDomains({ allowed_email_domains: '@Acme.com https://acme.io/team' }),
    ]).toEqual(['acme.com', 'acme.io']);
  });

  it('is empty when unset, which disables the domain rule', () => {
    expect(parseAllowedEmailDomains(undefined).size).toBe(0);
    expect(parseAllowedEmailDomains({ allowed_email_domains: '   ' }).size).toBe(0);
  });
});

describe('filterOrganizations', () => {
  it('keeps every organization when nothing is selected', () => {
    expect(filterOrganizations(orgs, parseTargetOrganizations({}))).toEqual(orgs);
  });

  it('narrows to the selected ids', () => {
    const targets = parseTargetOrganizations({ target_organizations: ['org-b'] });
    expect(filterOrganizations(orgs, targets)).toEqual([orgs[1]]);
  });

  it('matches on slug regardless of case', () => {
    const targets = parseTargetOrganizations({ target_organizations: ['ACME'] });
    expect(filterOrganizations(orgs, targets)).toEqual([orgs[0]]);
  });

  it('keeps every organization when the selection matches nothing', () => {
    const targets = parseTargetOrganizations({ target_organizations: ['org-gone'] });
    expect(filterOrganizations(orgs, targets)).toEqual(orgs);
  });
});
