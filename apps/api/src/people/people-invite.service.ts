import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { db } from '@db';
import { triggerEmail } from '../email/trigger-email';
import { InviteEmail } from '../email/templates/invite-member';
import { InvitePortalEmail } from '@trycompai/email';
import { BUILT_IN_ROLE_OBLIGATIONS, isRestrictedRole } from '@trycompai/auth';
import type { AuthContext } from '../auth/types';
import type { InviteItemDto } from './dto/invite-people.dto';
import { checkAutoCompletePhases } from '../frameworks/frameworks-timeline.helper';
import { TimelinesService } from '../timelines/timelines.service';
import {
  type CallerAuthority,
  resolveCallerAuthority,
} from './utils/caller-authority';
import {
  assertCanCreateMembers,
  authorizeTargetRoles,
} from './utils/member-creation-authorization';
import { authorizeRoleChange } from './utils/role-authorization';
import {
  rolesGrantAppAccess,
  rolesHaveCompliance,
} from './utils/role-capabilities';

interface ExistingMember {
  id: string;
  userId: string;
  role: string;
  isActive: boolean;
  deactivated: boolean;
}

export interface InviteResult {
  email: string;
  success: boolean;
  error?: string;
  emailSent?: boolean;
}

@Injectable()
export class PeopleInviteService {
  private readonly logger = new Logger(PeopleInviteService.name);

  constructor(private readonly timelinesService: TimelinesService) {}

  async inviteMembers(params: {
    organizationId: string;
    invites: InviteItemDto[];
    authContext: AuthContext;
  }): Promise<InviteResult[]> {
    const { organizationId, invites, authContext } = params;
    const callerUserId = authContext.userId ?? '';

    // Caller-level checks run once, so an unauthorized caller gets a single
    // 403 instead of a 201 with one error per row.
    const caller = await resolveCallerAuthority({
      organizationId,
      authContext,
    });
    assertCanCreateMembers(caller);

    // Invitation records require a valid inviter user (FK to User). API-key auth
    // has no caller user, so fall back to an org owner/admin — but only resolve
    // it lazily, when an invitation is actually created and after the role check
    // passes, so role errors aren't masked by inviter-resolution errors.
    let cachedInviterId: string | undefined;
    const getInviterId = async (): Promise<string> => {
      if (cachedInviterId === undefined) {
        cachedInviterId = await this.resolveInviterUserId(
          organizationId,
          callerUserId,
        );
      }
      return cachedInviterId;
    };

    const results: InviteResult[] = [];

    for (const invite of invites) {
      try {
        // Same role rules as POST /v1/people: no owner, no unknown or
        // over-privileged custom roles. Use only the returned, parsed roles
        // from here on — the raw input may smuggle roles via commas/spaces.
        const { roles, customRoles } = await authorizeTargetRoles({
          organizationId,
          roles: invite.roles,
          caller,
        });

        const email = invite.email.toLowerCase();
        const isStrictlyEmployee = roles.every(isRestrictedRole);

        const shouldSendPortalEmail =
          !!invite.sendPortalEmail &&
          rolesHaveCompliance({ roles, customRoles });
        const shouldSendAppEmail = rolesGrantAppAccess({ roles, customRoles });

        if (isStrictlyEmployee) {
          const result = await this.addEmployeeWithoutInvite({
            email,
            roles,
            organizationId,
            caller,
            sendPortalEmail: shouldSendPortalEmail,
          });
          results.push({
            email: invite.email,
            success: true,
            // Only surface email status when we actually attempted to send, so
            // the UI's "invite email could not be sent" warning never fires for
            // an intentional skip (portal invite unchecked).
            ...(shouldSendPortalEmail ? { emailSent: result.emailSent } : {}),
          });
        } else {
          await this.inviteWithCheck({
            email,
            roles,
            organizationId,
            caller,
            currentUserId: await getInviterId(),
            sendPortalEmail: shouldSendPortalEmail,
            sendAppEmail: shouldSendAppEmail,
          });
          results.push({ email: invite.email, success: true });
        }
      } catch (error) {
        this.logger.error(
          `Failed to invite ${invite.email}:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
        results.push({
          email: invite.email,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Check timeline auto-completion after inviting members (people metrics may change)
    const hasSuccessfulInvites = results.some((r) => r.success);
    if (hasSuccessfulInvites) {
      checkAutoCompletePhases({
        organizationId,
        timelinesService: this.timelinesService,
      }).catch((err) => {
        this.logger.warn('timeline auto-complete check failed', err);
      });
    }

    return results;
  }

  private async addEmployeeWithoutInvite({
    email,
    roles,
    organizationId,
    caller,
    sendPortalEmail,
  }: {
    email: string;
    roles: string[];
    organizationId: string;
    caller: CallerAuthority;
    sendPortalEmail?: boolean;
  }): Promise<{ emailSent: boolean }> {
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    if (!organization) {
      throw new BadRequestException('Organization not found.');
    }

    let userId = '';
    const existingUser = await db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (!existingUser) {
      // Mark the email verified up front: the address is admin-provided, and
      // every sign-in method (OTP, magic link, trusted OAuth) proves mailbox
      // ownership anyway. An unverified user row makes better-auth refuse to
      // link Google/Microsoft sign-ins to it (account_not_linked), which
      // strands invited employees at the portal sign-in page.
      const newUser = await db.user.create({
        data: { emailVerified: true, email, name: email.split('@')[0] },
      });
      userId = newUser.id;
    } else {
      // Legacy rows may predate the created-verified behavior (and the member
      // backfill only covered users who were members at the time), so upgrade
      // on re-invite too.
      await this.ensureEmailVerified(existingUser);
    }

    const finalUserId = existingUser?.id ?? userId;

    const existingMember = await db.member.findFirst({
      where: { userId: finalUserId, organizationId },
    });

    if (existingMember) {
      await this.applyRolesToExistingMember({
        existingMember,
        roles,
        organizationId,
        caller,
      });
    } else {
      const member = await db.member.create({
        data: {
          userId: finalUserId,
          organizationId,
          role: roles.join(','),
          isActive: true,
        },
      });
      await this.createTrainingVideoEntries(member.id, organizationId);
    }

    // Send the portal invite email only when requested (non-fatal). When the
    // admin opts out ("Send portal invite email" unchecked) we add the member
    // silently and send no email at all.
    let emailSent = false;
    if (sendPortalEmail) {
      try {
        const inviteLink = this.buildPortalUrl(organizationId);
        await triggerEmail({
          to: email,
          subject: `You've been invited to join ${organization.name} on Dilligent`,
          react: InvitePortalEmail({
            organizationName: organization.name,
            inviteLink,
            email,
          }),
        });
        emailSent = true;
      } catch (emailErr) {
        emailSent = false;
        this.logger.error(
          `Portal invite email failed after member was added: ${email}`,
          emailErr instanceof Error ? emailErr.message : 'Unknown error',
        );
      }
    }

    return { emailSent };
  }

  /**
   * Upgrade a legacy unverified user row to verified when (re-)inviting them.
   *
   * Invited addresses are admin-provided, and every sign-in method (email OTP,
   * magic link, trusted OAuth) proves mailbox ownership before a session is
   * issued, so the flag grants nothing to anyone who cannot already receive
   * mail at the address. Without it, better-auth refuses to link a
   * Google/Microsoft sign-in to the existing row (account_not_linked). No-op
   * when already verified.
   */
  private async ensureEmailVerified(user: {
    id: string;
    emailVerified: boolean;
  }): Promise<void> {
    if (user.emailVerified) {
      return;
    }
    await db.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
  }

  private async inviteWithCheck(params: {
    email: string;
    roles: string[];
    organizationId: string;
    caller: CallerAuthority;
    currentUserId: string;
    sendPortalEmail?: boolean;
    sendAppEmail?: boolean;
  }): Promise<void> {
    const {
      email,
      roles,
      organizationId,
      caller,
      currentUserId,
      sendPortalEmail,
      sendAppEmail,
    } = params;

    const existingUser = await db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (existingUser) {
      // Same rationale as the employee path: an unverified legacy row would
      // keep blocking Google/Microsoft sign-in linking (account_not_linked)
      // when this invitee goes to accept.
      await this.ensureEmailVerified(existingUser);

      const existingMember = await db.member.findFirst({
        where: { userId: existingUser.id, organizationId },
      });

      if (existingMember) {
        await this.applyRolesToExistingMember({
          existingMember,
          roles,
          organizationId,
          caller,
        });
        return;
      }
    }

    const roleString = roles.join(',');
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    if (!organization) {
      throw new BadRequestException('Organization not found.');
    }

    const invitation = await db.invitation.create({
      data: {
        email,
        organizationId,
        role: roleString,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        inviterId: currentUserId,
      },
    });

    await this.sendInviteEmails({
      email,
      organizationName: organization.name,
      sendPortalEmail,
      sendAppEmail,
      portalLink: this.buildPortalUrl(organizationId),
      appLink: this.buildInviteLink(invitation.id),
    });
  }

  /**
   * Re-adding someone who is already a member changes their membership, so it
   * follows the PATCH /v1/people/:id rules (member:update, not your own
   * roles, only an owner touches an owner).
   *
   * An inactive or deactivated member is reactivated with exactly the invited
   * roles. An active member gets the invited roles unioned into their
   * existing ones: an invitation/accept round-trip can't grant new roles to
   * someone already in the org (historically promoting an employee to admin
   * silently failed and the user hit "Access Denied").
   */
  private async applyRolesToExistingMember({
    existingMember,
    roles,
    organizationId,
    caller,
  }: {
    existingMember: ExistingMember;
    roles: string[];
    organizationId: string;
    caller: CallerAuthority;
  }): Promise<void> {
    const reactivate = existingMember.deactivated || !existingMember.isActive;
    const newRole = reactivate
      ? [...roles].sort().join(',')
      : this.mergeRoleString(existingMember.role, roles);
    if (
      !reactivate &&
      newRole === this.normalizeRoleString(existingMember.role)
    ) {
      return;
    }

    await authorizeRoleChange({
      organizationId,
      caller,
      targetMember: existingMember,
      newRole,
    });
    await db.member.update({
      where: { id: existingMember.id },
      data: reactivate
        ? { deactivated: false, isActive: true, role: newRole }
        : { role: newRole },
    });
  }

  /** Sort + de-dupe a comma-separated role string into a canonical form. */
  private normalizeRoleString(role: string | null | undefined): string {
    return [
      ...new Set(
        (role ?? '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean),
      ),
    ]
      .sort()
      .join(',');
  }

  /** Union new roles into an existing comma-separated role string. */
  private mergeRoleString(
    existingRole: string | null | undefined,
    addedRoles: string[],
  ): string {
    return [
      ...new Set([
        ...(existingRole ?? '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean),
        ...addedRoles.map((r) => r.trim()).filter(Boolean),
      ]),
    ]
      .sort()
      .join(',');
  }

  async resendPortalInvite(params: {
    organizationId: string;
    memberId: string;
  }): Promise<{ success: boolean }> {
    const { organizationId, memberId } = params;

    const member = await db.member.findFirst({
      where: { id: memberId, organizationId },
      include: { user: true, organization: { select: { name: true } } },
    });

    if (!member) {
      throw new BadRequestException('Member not found.');
    }

    const roles = member.role.split(',').map((r) => r.trim());
    const hasCompliance = await this.rolesHaveComplianceObligation(
      roles,
      organizationId,
    );
    if (!hasCompliance) {
      throw new BadRequestException(
        'Portal invites can only be sent to members with compliance obligations.',
      );
    }

    const email = member.user.email;
    const inviteLink = this.buildPortalUrl(organizationId);

    await triggerEmail({
      to: email,
      subject: `Access your ${member.organization.name} Employee Portal on Dilligent`,
      react: InvitePortalEmail({
        organizationName: member.organization.name,
        inviteLink,
        email,
      }),
    });

    return { success: true };
  }

  private async createTrainingVideoEntries(
    memberId: string,
    organizationId?: string,
  ): Promise<void> {
    const trainingVideoIds = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'];

    if (organizationId) {
      const hipaaInstance = await db.frameworkInstance.findFirst({
        where: { organizationId, framework: { name: 'HIPAA' } },
        select: { id: true },
      });
      if (hipaaInstance) {
        trainingVideoIds.push('hipaa-sat-1');
      }
    }

    await db.employeeTrainingVideoCompletion.createMany({
      data: trainingVideoIds.map((videoId) => ({
        memberId,
        videoId,
      })),
      skipDuplicates: true,
    });
  }

  private async sendInviteEmails(params: {
    email: string;
    organizationName: string;
    sendPortalEmail?: boolean;
    sendAppEmail?: boolean;
    portalLink: string;
    appLink: string;
  }): Promise<void> {
    const {
      email,
      organizationName,
      sendPortalEmail,
      sendAppEmail,
      portalLink,
      appLink,
    } = params;

    if (sendAppEmail) {
      await triggerEmail({
        to: email,
        subject: `You've been invited to join ${organizationName} on Dilligent`,
        react: InviteEmail({
          organizationName,
          inviteLink: appLink,
          portalLink: sendPortalEmail ? portalLink : undefined,
        }),
      });
    } else if (sendPortalEmail) {
      await triggerEmail({
        to: email,
        subject: `You've been invited to join ${organizationName} on Dilligent`,
        react: InvitePortalEmail({
          organizationName,
          inviteLink: portalLink,
          email,
        }),
      });
    } else {
      await triggerEmail({
        to: email,
        subject: `You've been invited to join ${organizationName} on Dilligent`,
        react: InviteEmail({
          organizationName,
          inviteLink: appLink,
        }),
      });
    }
  }

  private async rolesHaveComplianceObligation(
    roles: string[],
    organizationId: string,
  ): Promise<boolean> {
    const customRoleNames = roles.filter(
      (role) => !Object.hasOwn(BUILT_IN_ROLE_OBLIGATIONS, role),
    );
    const customRoles = customRoleNames.length
      ? await db.organizationRole.findMany({
          where: { organizationId, name: { in: customRoleNames } },
          select: { obligations: true },
        })
      : [];
    return rolesHaveCompliance({ roles, customRoles });
  }

  /**
   * Resolve the user to attribute an invitation to. Session callers use their
   * own userId. API-key callers have no user, so fall back to an active org
   * owner (then admin). Invitation.inviterId is a required FK, so this must
   * return a valid user id.
   */
  private async resolveInviterUserId(
    organizationId: string,
    callerUserId: string,
  ): Promise<string> {
    if (callerUserId) return callerUserId;

    for (const roleNeedle of ['owner', 'admin']) {
      const member = await db.member.findFirst({
        where: {
          organizationId,
          isActive: true,
          deactivated: false,
          role: { contains: roleNeedle },
        },
        select: { userId: true },
        orderBy: { createdAt: 'asc' },
      });
      if (member?.userId) return member.userId;
    }

    throw new BadRequestException(
      'Cannot determine an inviter: the organization has no active owner or admin to attribute the invitation to.',
    );
  }

  private buildPortalUrl(organizationId: string): string {
    const portalUrl =
      process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://portal.trycomp.ai';
    return `${portalUrl}/${organizationId}`;
  }

  private buildInviteLink(invitationId: string): string {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.BETTER_AUTH_URL ??
      'https://app.trycomp.ai';
    return `${appUrl}/invite/${invitationId}`;
  }
}
