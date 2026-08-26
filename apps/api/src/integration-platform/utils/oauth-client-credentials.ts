/**
 * OAuth client ids and secrets are entered by hand, and copying them out of a provider
 * console almost always brings along a trailing newline or space. That whitespace survives
 * encryption, so it is still there when the authorize URL is built — where `client_id` is
 * percent-encoded and the provider is handed a value it has never issued. Google answers
 * that with its own `Error 401: invalid_client` page, before any redirect back to us, so
 * nothing reaches the OAuth error log and the credential looks correct in every UI that
 * shows it.
 *
 * Normalizing on the way in and on the way out means a credential already stored with
 * stray whitespace is repaired on next use rather than needing to be re-entered.
 */
export function normalizeOAuthClientCredential(value: string): string {
  // `trim()` covers unicode whitespace and every line terminator, which is what a paste
  // introduces. Interior characters are left alone — they may be legitimate.
  return value.trim();
}

/** Whether normalizing would change the value, i.e. it carries stray outer whitespace. */
export function hasStrayWhitespace(value: string): boolean {
  return normalizeOAuthClientCredential(value) !== value;
}
