/**
 * Legal-entity suffixes stripped before comparison, so "Acme, Inc." and "Acme" are the same
 * vendor. Longest-first matters: "co ltd" must be tried before "co".
 */
const LEGAL_SUFFIXES = [
  'co ltd',
  'pty ltd',
  'pte ltd',
  'incorporated',
  'corporation',
  'limited',
  'holdings',
  'company',
  'group',
  'gmbh',
  'sarl',
  'b v',
  'n v',
  'a s',
  'oy',
  'ab',
  'as',
  'llc',
  'llp',
  'ltd',
  'inc',
  'corp',
  'plc',
  'sa',
  'srl',
  'spa',
  'kk',
  'co',
];

/**
 * Boilerplate OAuth clients append to their consent-screen name. Google shows the app's own
 * display text, and plenty of apps register themselves as "Sign in with Notion" or
 * "Notion (Web)", which must resolve to the same vendor as "Notion".
 */
const SIGN_IN_BOILERPLATE = [
  /^sign[- ]?in with\s+/i,
  /^sign[- ]?up with\s+/i,
  /^log[- ]?in with\s+/i,
  /^continue with\s+/i,
  /\s+sign[- ]?in$/i,
  /\s+login$/i,
  /\s+oauth$/i,
  /\s+sso$/i,
];

/** Parenthesised or bracketed platform qualifiers: "Figma (Desktop)", "Slack [Beta]". */
const TRAILING_QUALIFIER = /[([{][^)\]}]*[)\]}]\s*$/;

/**
 * Reduce a vendor or application display name to a comparable form.
 *
 * Used only for **exact** equality after normalization. Deliberately not a similarity score:
 * a fuzzy match that links the wrong vendor is worse than no link at all, because it silently
 * attributes one company's access to another in an auditable register.
 *
 * Returns an empty string for a name with no comparable content, which callers must treat as
 * unresolvable rather than as a match against other empty names.
 */
export function normalizeVendorName(name: string | null | undefined): string {
  if (!name) return '';

  // NFKD splits accented characters into base + combining mark, which the escape below
  // then removes, so "Sébastien" and "Sebastien" compare equal.
  let result = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of SIGN_IN_BOILERPLATE) {
      const next = result.replace(pattern, '');
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
    const trimmedQualifier = result.replace(TRAILING_QUALIFIER, '');
    if (trimmedQualifier !== result && trimmedQualifier.trim() !== '') {
      result = trimmedQualifier;
      changed = true;
    }
  }

  result = result
    .toLowerCase()
    // Punctuation to spaces so "acme,inc" and "acme inc" converge.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  // Strip legal suffixes repeatedly: "Acme Holdings Ltd" -> "acme".
  changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (result === suffix) {
        // The whole name is a suffix — leave it rather than reduce to nothing.
        continue;
      }
      if (result.endsWith(` ${suffix}`)) {
        result = result.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }

  return result.replace(/\s+/g, ' ').trim();
}

/** Names that carry no identity and must never be sent for inference or matched on. */
export function isUnusableVendorName(name: string | null | undefined): boolean {
  if (!name) return true;
  const normalized = normalizeVendorName(name);
  if (normalized === '') return true;
  return normalized === 'anonymous' || normalized === 'unknown';
}
