import {
  hasStrayWhitespace,
  normalizeOAuthClientCredential,
} from './oauth-client-credentials';

describe('normalizeOAuthClientCredential', () => {
  it('strips the trailing newline a console copy-paste leaves behind', () => {
    expect(
      normalizeOAuthClientCredential('123-abc.apps.googleusercontent.com\n'),
    ).toBe('123-abc.apps.googleusercontent.com');
  });

  it('strips leading and trailing spaces and tabs', () => {
    expect(normalizeOAuthClientCredential('  \tGOCSPX-secret \t')).toBe(
      'GOCSPX-secret',
    );
  });

  it('leaves a clean value untouched', () => {
    expect(normalizeOAuthClientCredential('GOCSPX-secret')).toBe(
      'GOCSPX-secret',
    );
  });

  it('leaves interior characters alone', () => {
    expect(normalizeOAuthClientCredential(' a b ')).toBe('a b');
  });

  it('reduces a whitespace-only value to an empty string', () => {
    expect(normalizeOAuthClientCredential(' \n\t ')).toBe('');
  });
});

describe('hasStrayWhitespace', () => {
  it('flags a value that normalizing would change', () => {
    expect(hasStrayWhitespace('client-id\n')).toBe(true);
  });

  it('does not flag a clean value', () => {
    expect(hasStrayWhitespace('client-id')).toBe(false);
  });
});
