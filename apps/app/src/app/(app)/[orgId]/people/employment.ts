import type { EmploymentType } from '@db';

/**
 * Employment classification shown across the People section. Values mirror the
 * `EmploymentType` Prisma enum; labels are what the UI renders.
 */
export const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'contract', label: 'Contract' },
];

export const DEFAULT_EMPLOYMENT_TYPE: EmploymentType = 'permanent';

export function getEmploymentTypeLabel(type: EmploymentType | null | undefined): string {
  return (
    EMPLOYMENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ??
    'Permanent'
  );
}
