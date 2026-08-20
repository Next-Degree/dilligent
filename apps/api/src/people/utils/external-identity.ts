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
