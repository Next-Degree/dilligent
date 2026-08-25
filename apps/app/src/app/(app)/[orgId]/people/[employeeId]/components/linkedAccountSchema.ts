import { z } from 'zod';

/** Radix/base-ui Select cannot hold an empty string, so "unlinked" needs a sentinel. */
export const SOURCE_NONE = 'none';

/**
 * Providers a member can be linked to. Mirrors EXTERNAL_USER_SOURCES on the
 * API — a provider belongs here only if its Employee Access check emits an
 * email as the result's resourceId, otherwise the link would match nothing.
 */
export const SOURCE_OPTIONS = [
  { value: SOURCE_NONE, label: 'Not linked' },
  { value: 'github', label: 'GitHub' },
] as const;

// Mirrors the backend's @IsEmail() on UpdatePeopleDto.externalUserId so the
// form rejects values the PATCH /v1/people/:id endpoint would reject anyway.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Provider and email are only meaningful as a pair, mirroring the API's
 * validateExternalIdentityUpdate. A single superRefine rather than chained
 * refines so every rule is evaluated against the same value.
 */
export const linkedAccountSchema = z
  .object({
    externalUserSource: z.enum([SOURCE_NONE, 'github']),
    externalUserId: z.string(),
  })
  .superRefine((value, ctx) => {
    const linked = value.externalUserSource !== SOURCE_NONE;
    const email = value.externalUserId.trim();

    if (!linked && email !== '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Choose the provider this email belongs to.',
        path: ['externalUserSource'],
      });
      return;
    }
    if (linked && email === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the email used on this provider.',
        path: ['externalUserId'],
      });
      return;
    }
    if (email !== '' && !EMAIL_REGEX.test(email)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid email address.',
        path: ['externalUserId'],
      });
    }
  });

export type LinkedAccountValues = z.infer<typeof linkedAccountSchema>;

export function toSourceValue(source: string | null): LinkedAccountValues['externalUserSource'] {
  return source === 'github' ? 'github' : SOURCE_NONE;
}
