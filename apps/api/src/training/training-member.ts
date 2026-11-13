import { db } from '@db';

/**
 * The name, email and organization a training email or certificate is
 * addressed to, or the reason the member cannot be resolved.
 */
export async function resolveMemberForCertificate({
  memberId,
  organizationId,
}: {
  memberId: string;
  organizationId: string;
}): Promise<
  | { userName: string; email: string; organizationName: string }
  | { reason: string }
> {
  const member = await db.member.findUnique({
    where: { id: memberId },
    include: {
      user: { select: { email: true, name: true } },
      organization: { select: { name: true } },
    },
  });

  if (!member?.user) return { reason: 'member_not_found' };
  if (!member.user.email) return { reason: 'no_email' };
  if (member.organizationId !== organizationId)
    return { reason: 'organization_mismatch' };

  return {
    userName: member.user.name || 'Team Member',
    email: member.user.email,
    organizationName: member.organization?.name || 'Organization',
  };
}
