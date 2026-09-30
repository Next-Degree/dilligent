import type { AssigneeOption } from '@/components/SelectAssignee';
import { filterAppAccessMembers } from '@/lib/compliance';
import { canAccessApp, resolveBuiltInPermissions } from '@/lib/permissions';

/** A member from the `/v1/people` response; `role` is the org role(s). */
export interface OrgPerson extends AssigneeOption {
  role: string;
  deactivated: boolean;
  user: AssigneeOption['user'] & { id: string };
}

/**
 * The org's internal people, offered as a vendor's Assignee: active members
 * whose built-in role grants App Access (owner, admin, auditor). Custom roles
 * are deliberately ignored here; they are offered as System Owner instead.
 */
export function selectInternalPeople(people: OrgPerson[]): OrgPerson[] {
  return people.filter(
    (p) => !p.deactivated && canAccessApp(resolveBuiltInPermissions(p.role).permissions),
  );
}

/**
 * The org's people offered as a vendor's System Owner: the internal people
 * plus members holding a custom role with App Access (e.g. a "System Owner"
 * role given to employees). Custom roles are resolved from the org's role
 * definitions, so `employee,System Owner` qualifies when that role has App
 * Access. Portal-only members never see the vendor record, so they are not
 * offered.
 */
export async function selectSystemOwnerCandidates(
  people: OrgPerson[],
  { orgId }: { orgId: string },
): Promise<OrgPerson[]> {
  const activePeople = people.filter((p) => !p.deactivated);
  return filterAppAccessMembers(activePeople, orgId);
}
