/**
 * People-directory access for integration checks.
 *
 * The `@trycompai/integration-platform` package has no database of its own, so
 * checks that need to answer "is this provider account a person we employ?"
 * receive a host-supplied {@link DirectoryProvider}. This module is that host
 * implementation, backed by Prisma.
 *
 * Used by the GitHub account-association and deprovisioning checks. Any future
 * access-review check for another provider can reuse it unchanged.
 */

import type {
  DirectoryLinkedEmail,
  DirectoryPerson,
  DirectoryProvider,
} from '@trycompai/integration-platform';
import { db } from '@db';
import { orgParticipantMemberWhere } from '../../utils/org-participation';

/**
 * A member's provider-linked email, from the `externalUserSource` /
 * `externalUserId` pair on their People record. The API rejects a half-set
 * pair, but this reads defensively: a row written before that validation, or by
 * a direct database edit, must not produce a linked email with no provider
 * (it would match every provider) or a provider with no email.
 */
function resolveLinkedEmails({
  externalUserSource,
  externalUserId,
}: {
  externalUserSource: string | null;
  externalUserId: string | null;
}): DirectoryLinkedEmail[] {
  const source = externalUserSource?.trim().toLowerCase();
  const email = externalUserId?.trim().toLowerCase();
  if (!source || !email) return [];
  return [{ source, email }];
}

/**
 * A member counts as active personnel unless they have been deactivated,
 * flagged inactive, or their offboard date has already passed. The offboard
 * date is what makes "still has access after leaving" detectable even when the
 * membership record itself was never deactivated — which is precisely the
 * failure a deprovisioning control exists to catch.
 */
function resolveIsActive({
  isActive,
  deactivated,
  offboardDate,
  now,
}: {
  isActive: boolean;
  deactivated: boolean;
  offboardDate: Date | null;
  now: Date;
}): boolean {
  if (deactivated) return false;
  if (!isActive) return false;
  if (offboardDate && offboardDate.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Build a {@link DirectoryProvider} scoped to one organization.
 *
 * The query is deferred until a check actually calls `listPeople()`, so runs
 * whose checks never touch the directory pay nothing for it.
 */
export function createDirectoryProvider({
  organizationId,
}: {
  organizationId: string;
}): DirectoryProvider {
  return {
    listPeople: async (): Promise<DirectoryPerson[]> => {
      // Platform admins are Comp AI staff attached to a customer org, not that
      // org's personnel — counting them would report our own accounts as
      // unassociated GitHub users on every customer.
      const participantWhere = await orgParticipantMemberWhere(organizationId);

      const members = await db.member.findMany({
        where: { organizationId, ...participantWhere },
        select: {
          id: true,
          isActive: true,
          deactivated: true,
          department: true,
          jobTitle: true,
          offboardDate: true,
          externalUserSource: true,
          externalUserId: true,
          user: { select: { email: true, name: true } },
        },
      });

      const now = new Date();

      return members
        .map((member): DirectoryPerson | null => {
          // Emails are the join key for every provider that reports one, so
          // normalize once here rather than in each check.
          const email = member.user?.email?.trim().toLowerCase();
          if (!email) return null;

          return {
            id: member.id,
            email,
            linkedEmails: resolveLinkedEmails({
              externalUserSource: member.externalUserSource,
              externalUserId: member.externalUserId,
            }),
            name: member.user?.name?.trim() || null,
            isActive: resolveIsActive({
              isActive: member.isActive,
              deactivated: member.deactivated,
              offboardDate: member.offboardDate,
              now,
            }),
            department: member.department || null,
            jobTitle: member.jobTitle || null,
            offboardDate: member.offboardDate?.toISOString() ?? null,
          };
        })
        .filter((person): person is DirectoryPerson => person !== null);
    },
  };
}
