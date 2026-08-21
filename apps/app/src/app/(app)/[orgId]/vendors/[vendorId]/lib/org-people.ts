import { canAccessApp, resolveBuiltInPermissions } from '@/lib/permissions';

export interface OrgPerson {
  id: string;
  role: string;
  deactivated: boolean;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    /**
     * Platform role (`'admin'` = Comp AI staff), not the org role above.
     * `SelectAssignee` reads it to keep platform admins out of customer orgs.
     */
    role?: string | null;
  };
}

export interface OrgPersonOption {
  id: string;
  role: string;
  user: OrgPerson['user'];
  organizationId: string;
  deactivated: false;
}

/**
 * The org's people who can be picked as a vendor's Assignee or System Owner:
 * active members with App Access (`app:read`, held by owner/admin/auditor and
 * any custom role with the toggle on). Portal-only members — employees and
 * contractors — never see the vendor record, so they are not offered.
 */
export function selectAppAccessPeople(
  people: OrgPerson[],
  { orgId }: { orgId: string },
): OrgPersonOption[] {
  return people
    .filter((p) => !p.deactivated && canAccessApp(resolveBuiltInPermissions(p.role).permissions))
    .map((p) => ({
      id: p.id,
      role: p.role,
      user: p.user,
      organizationId: orgId,
      deactivated: false,
    }));
}
