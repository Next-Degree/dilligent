'use client';

import type { AssigneeOption } from '@/components/SelectAssignee';
import type { User, Vendor } from '@db';
import { UpdateSecondaryFieldsForm } from './update-secondary-fields-form';

export function SecondaryFields({
  vendor,
  assignees,
  systemOwners,
  onUpdate,
}: {
  vendor: Vendor & { assignee: { user: User | null } | null };
  assignees: AssigneeOption[];
  systemOwners: AssigneeOption[];
  onUpdate?: () => void;
}) {
  return (
    <UpdateSecondaryFieldsForm
      vendor={vendor}
      assignees={assignees}
      systemOwners={systemOwners}
      onUpdate={onUpdate}
    />
  );
}
