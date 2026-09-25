import { BadRequestException } from '@nestjs/common';

/**
 * How a member is employed by the organization. Values match the
 * `EmploymentType` Prisma enum; they're declared here as literals so the
 * validators and this resolver don't depend on the generated client at runtime.
 */
export const EMPLOYMENT_TYPES = ['permanent', 'contract'] as const;

export type EmploymentTypeValue = (typeof EMPLOYMENT_TYPES)[number];

export const DEFAULT_EMPLOYMENT: EmploymentState = {
  employmentType: 'permanent',
  contractExpiryDate: null,
};

export interface EmploymentState {
  employmentType: EmploymentTypeValue;
  contractExpiryDate: Date | null;
}

interface EmploymentUpdate {
  employmentType?: EmploymentTypeValue;
  contractExpiryDate?: string | Date | null;
}

/**
 * Resolves the employment fields of a member write against the two invariants
 * the People section relies on:
 *
 * 1. A contract member always has a contract expiry date.
 * 2. A permanent member never has one — moving back to permanent clears any
 *    expiry left over from an earlier contract.
 *
 * `current` is the member's stored state (or DEFAULT_EMPLOYMENT on create), so
 * a partial update stays consistent: switching someone to contract is rejected
 * unless an expiry is supplied or already on file, and changing only the expiry
 * keeps the stored type.
 *
 * Returns the fields to write, or `{}` when the update touches neither.
 */
export function resolveEmploymentUpdate({
  current,
  update,
}: {
  current: EmploymentState;
  update: EmploymentUpdate;
}): Partial<EmploymentState> {
  const typeChanged = update.employmentType !== undefined;
  const expiryChanged = update.contractExpiryDate !== undefined;

  if (!typeChanged && !expiryChanged) return {};

  const employmentType = update.employmentType ?? current.employmentType;

  if (employmentType === 'permanent') {
    if (expiryChanged && update.contractExpiryDate !== null) {
      throw new BadRequestException(
        'Contract expiry date can only be set on contract employment',
      );
    }
    // Always written: a permanent member must not keep a stale expiry.
    return { employmentType, contractExpiryDate: null };
  }

  const contractExpiryDate = expiryChanged
    ? parseExpiry(update.contractExpiryDate)
    : current.contractExpiryDate;

  if (!contractExpiryDate) {
    throw new BadRequestException(
      'Contract expiry date is required for contract employment',
    );
  }

  return { employmentType, contractExpiryDate };
}

function parseExpiry(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Contract expiry date is not a valid date');
  }
  return parsed;
}
