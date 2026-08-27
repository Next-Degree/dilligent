import { BadRequestException } from '@nestjs/common';

/**
 * Providers a member's account can be linked to.
 *
 * Deliberately narrow: a source belongs here only if its Employee Access check
 * emits an email as the row's `resourceId`. A check that keys on something else
 * (a GitHub login, a vendor uid) would never match the linked email, so listing
 * it would offer a link that silently does nothing.
 */
export const EXTERNAL_USER_SOURCES = ['github'] as const;

export type ExternalUserSource = (typeof EXTERNAL_USER_SOURCES)[number];

interface ExternalIdentityFields {
  externalUserSource?: string | null;
  externalUserId?: string | null;
}

/**
 * `externalUserSource` and `externalUserId` are only meaningful as a pair —
 * the id is the email the member uses on that provider, the source records
 * which provider it came from.
 *
 * A half-set pair would widen access matching with no record of where the extra
 * email came from, and a bare source would imply a link that matches nothing,
 * so both are rejected. Clearing is the symmetric case: both null unlinks.
 *
 * Callers must send both fields whenever either changes; a PATCH carrying only
 * one is rejected rather than merged against the stored value, so the request
 * body always states the resulting pair in full.
 */
export function validateExternalIdentityUpdate(
  update: ExternalIdentityFields,
): void {
  const sourceTouched = update.externalUserSource !== undefined;
  const idTouched = update.externalUserId !== undefined;
  if (!sourceTouched && !idTouched) return;

  const source = update.externalUserSource ?? null;
  const externalId = update.externalUserId ?? null;

  if ((source === null) !== (externalId === null)) {
    throw new BadRequestException(
      'externalUserSource and externalUserId must be set together, or both cleared',
    );
  }
}

interface MemberIdentity {
  externalUserId?: string | null;
  externalUserSource?: string | null;
  user: { email: string | null };
}

/** An email in the form checks emit it, or null when there isn't one. */
export function normalizeEmail(
  value: string | null | undefined,
): string | null {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

/**
 * The emails that identify a member on an integration's checks: the address
 * they sign in with, plus the account they linked on a provider, if any.
 *
 * Person-scoped checks emit one row per person keyed by lowercased email, so
 * these two values are the whole basis for deciding that a reported account is
 * one of our people — used both to read one member's access and to attribute a
 * vendor's reported users back to members.
 *
 * Pass `source` to honour the link only while reading that provider's checks: a
 * GitHub-linked address says nothing about who holds an account elsewhere, and
 * attributing one provider's account to a person on another's evidence is the
 * misattribution worth avoiding. Callers that pass it must select
 * `externalUserSource`; omitting `source` matches the link on any provider.
 */
export function memberIdentityEmails(
  member: MemberIdentity,
  { source }: { source?: string } = {},
): { email: string | null; linked: string | null } {
  const email = normalizeEmail(member.user.email);
  const linkedOnThisSource =
    source === undefined || member.externalUserSource === source;
  const linked = linkedOnThisSource
    ? normalizeEmail(member.externalUserId)
    : null;
  return { email, linked: linked === email ? null : linked };
}
