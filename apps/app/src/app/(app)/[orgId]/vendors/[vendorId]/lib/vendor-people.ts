import { hasPermission, resolveBuiltInPermissions } from '@/lib/permissions';

export interface VendorPerson {
  id: string;
  role: string;
  deactivated: boolean;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
}

export interface VendorPersonOption {
  id: string;
  role: string;
  user: VendorPerson['user'];
  organizationId: string;
  deactivated: false;
}

/**
 * Splits an org's people into the two distinct pickers the vendor form uses.
 * - Assignee (Compliance): runs the risk assessment, so must be able to edit
 *   vendors — restricted to members whose role(s) grant vendor:update
 *   (admins/owners). Read-only roles like auditor are excluded.
 * - System Owner (Vendor Management): just the day-to-day owner of the
 *   system, so any active org member is a valid pick.
 */
export function splitVendorPeople(
  people: VendorPerson[],
  { orgId }: { orgId: string },
): { assignees: VendorPersonOption[]; owners: VendorPersonOption[] } {
  const activePeople = people.filter((p) => !p.deactivated);
  const toOption = (p: VendorPerson): VendorPersonOption => ({
    id: p.id,
    role: p.role,
    user: p.user,
    organizationId: orgId,
    deactivated: false,
  });

  const owners = activePeople.map(toOption);
  const assignees = activePeople
    .filter((p) => hasPermission(resolveBuiltInPermissions(p.role).permissions, 'vendor', 'update'))
    .map(toOption);

  return { assignees, owners };
}
