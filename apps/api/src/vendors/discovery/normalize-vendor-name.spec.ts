import {
  isUnusableVendorName,
  normalizeVendorName,
} from './normalize-vendor-name';

describe('normalizeVendorName', () => {
  it('ignores case and punctuation', () => {
    expect(normalizeVendorName('Acme, Inc.')).toBe('acme');
    expect(normalizeVendorName('ACME')).toBe('acme');
  });

  it('strips diacritics so accented and unaccented names converge', () => {
    expect(normalizeVendorName('Sébastien')).toBe(normalizeVendorName('Sebastien'));
  });

  it('strips legal-entity suffixes, including stacked ones', () => {
    expect(normalizeVendorName('Acme Holdings Ltd')).toBe('acme');
    expect(normalizeVendorName('Acme GmbH')).toBe('acme');
    expect(normalizeVendorName('Acme Co Ltd')).toBe('acme');
  });

  it('strips sign-in boilerplate that OAuth consent screens add', () => {
    expect(normalizeVendorName('Sign in with Notion')).toBe('notion');
    expect(normalizeVendorName('Continue with Figma')).toBe('figma');
    expect(normalizeVendorName('Slack SSO')).toBe('slack');
  });

  it('strips trailing platform qualifiers', () => {
    expect(normalizeVendorName('Figma (Desktop)')).toBe('figma');
    expect(normalizeVendorName('Slack [Beta]')).toBe('slack');
  });

  it('does not reduce a name that is entirely a legal suffix to nothing', () => {
    // "Group" as a whole vendor name is unusual but real; reducing it to '' would make it
    // compare equal to every other unnameable app.
    expect(normalizeVendorName('Group')).toBe('group');
  });

  it('keeps distinct vendors distinct — no fuzzy collapsing', () => {
    // The near-miss case: a wrong link silently attributes one company's access to another.
    expect(normalizeVendorName('Acme')).not.toBe(normalizeVendorName('Acme Analytics'));
    expect(normalizeVendorName('Notion')).not.toBe(normalizeVendorName('Notium'));
  });

  it('returns empty string for names with no comparable content', () => {
    expect(normalizeVendorName('')).toBe('');
    expect(normalizeVendorName(null)).toBe('');
    expect(normalizeVendorName('   ')).toBe('');
    expect(normalizeVendorName('!!!')).toBe('');
  });
});

describe('isUnusableVendorName', () => {
  it.each([null, undefined, '', '   ', '???', 'Anonymous', 'unknown'])(
    'treats %p as unusable',
    (name) => {
      expect(isUnusableVendorName(name)).toBe(true);
    },
  );

  it('treats a real name as usable', () => {
    expect(isUnusableVendorName('Notion')).toBe(false);
  });
});
