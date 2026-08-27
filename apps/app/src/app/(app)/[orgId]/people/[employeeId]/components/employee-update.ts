import type { EmploymentType, Member, User } from '@db';
import { DEFAULT_EMPLOYMENT_TYPE } from '../../employment';

export interface EmployeeUpdate {
  name?: string;
  email?: string;
  department?: string;
  isActive?: boolean;
  jobTitle?: string;
  onboardDate?: string | null;
  offboardDate?: string | null;
  employmentType?: EmploymentType;
  contractExpiryDate?: string | null;
}

export interface EmployeeFormValues {
  name: string;
  email: string;
  jobTitle: string;
  department: string;
  status: string;
  employmentType: EmploymentType;
  contractExpiryDate: Date | undefined;
  onboardDate: Date | undefined;
  offboardDate: Date | undefined;
}

const toIso = (date: Date | null | undefined) =>
  date ? new Date(date).toISOString() : null;

/**
 * Diffs the employee form against the stored member, so the PATCH carries only
 * what actually changed — the endpoint treats a present key as an edit.
 */
export function buildEmployeeUpdate({
  employee,
  values,
}: {
  employee: Member & { user: User };
  values: EmployeeFormValues;
}): EmployeeUpdate {
  const update: EmployeeUpdate = {};

  if (values.name !== (employee.user.name ?? '')) {
    update.name = values.name;
  }

  const trimmedEmail = values.email.trim();
  if (trimmedEmail !== (employee.user.email ?? '')) {
    update.email = trimmedEmail;
  }

  if (values.jobTitle !== (employee.jobTitle ?? '')) {
    update.jobTitle = values.jobTitle;
  }

  if (values.department !== employee.department) {
    update.department = values.department;
  }

  const isActive = values.status === 'active';
  if (isActive !== employee.isActive) {
    update.isActive = isActive;
  }

  if (toIso(values.onboardDate) !== toIso(employee.onboardDate)) {
    update.onboardDate = toIso(values.onboardDate);
  }

  if (toIso(values.offboardDate) !== toIso(employee.offboardDate)) {
    update.offboardDate = toIso(values.offboardDate);
  }

  const storedEmploymentType = employee.employmentType ?? DEFAULT_EMPLOYMENT_TYPE;
  if (values.employmentType !== storedEmploymentType) {
    update.employmentType = values.employmentType;
  }

  // Only contract members carry an expiry: the API clears it when someone goes
  // permanent and rejects a date sent for a permanent member.
  if (
    values.employmentType === 'contract' &&
    toIso(values.contractExpiryDate) !== toIso(employee.contractExpiryDate)
  ) {
    update.contractExpiryDate = toIso(values.contractExpiryDate);
  }

  return update;
}
