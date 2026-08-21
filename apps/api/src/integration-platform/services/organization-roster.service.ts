import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import type { OrganizationMemberSummary } from '@trycompai/integration-platform';

/**
 * Supplies the Comp AI employee roster to integration checks.
 *
 * Access-lifecycle checks (offboarding, account attribution) reconcile the
 * accounts a provider reports against the people who actually work here — a
 * comparison no provider API can make on its own. This service is the single
 * place that reads members for that purpose, so checks never touch the
 * database themselves.
 */
const normalize = (email: string | null | undefined): string | null => {
  const normalized = email?.toLowerCase().trim();
  return normalized ? normalized : null;
};

@Injectable()
export class OrganizationRosterService {
  private readonly logger = new Logger(OrganizationRosterService.name);

  /**
   * Every member of the organization, leavers included: a check needs the
   * deactivated ones to tell "left the company but still has access" apart
   * from "never worked here".
   */
  async listMembers(
    organizationId: string,
  ): Promise<OrganizationMemberSummary[]> {
    const members = await db.member.findMany({
      where: { organizationId },
      select: {
        role: true,
        isActive: true,
        deactivated: true,
        department: true,
        offboardDate: true,
        externalUserId: true,
        externalUserSource: true,
        user: { select: { name: true, email: true } },
      },
    });

    return members.map((member) => {
      const primary = normalize(member.user.email);
      // Same identity rule as PeopleAccessService: a member is matched by their
      // primary email OR their linked provider email, so an account held under
      // a personal address still resolves to the right person.
      const emails = [primary, normalize(member.externalUserId)].filter(
        (email): email is string => email !== null,
      );

      return {
        email: primary,
        emails: Array.from(new Set(emails)),
        linkedEmailSource: member.externalUserId
          ? (member.externalUserSource ?? null)
          : null,
        name: member.user.name ?? null,
        role: member.role,
        isActive: member.isActive && !member.deactivated,
        department: member.department ?? null,
        offboardDate: member.offboardDate
          ? member.offboardDate.toISOString()
          : null,
      };
    });
  }

  /**
   * Bind the roster to one organization for `runAllChecks`. A read failure is
   * logged and rethrown rather than degrading to an empty roster: a check that
   * received `[]` would read it as "nobody works here", turning a transient
   * database error into a finding against every account.
   */
  provider(organizationId: string): () => Promise<OrganizationMemberSummary[]> {
    return async () => {
      try {
        return await this.listMembers(organizationId);
      } catch (error) {
        this.logger.error(
          `Failed to load member roster for organization ${organizationId}`,
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      }
    };
  }
}
