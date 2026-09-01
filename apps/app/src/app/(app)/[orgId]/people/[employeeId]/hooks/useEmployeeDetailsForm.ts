'use client';

import { useApi } from '@/hooks/use-api';
import type { EmploymentType, Member, User } from '@db';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DEFAULT_EMPLOYMENT_TYPE } from '../../employment';
import { buildEmployeeUpdate } from '../components/employee-update';

// Mirrors the backend's @IsEmail() on UpdatePeopleDto.email so the form rejects
// values the PATCH /v1/people/:id endpoint would reject anyway.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value: string) => EMAIL_REGEX.test(value);

type Employee = Member & { user: User };

/**
 * Owns the employee details form: field state, the diff that gets PATCHed, and
 * the save itself. Kept out of the component so the form stays presentational.
 */
export function useEmployeeDetailsForm(employee: Employee) {
  const [name, setName] = useState(employee.user.name ?? '');
  const [email, setEmail] = useState(employee.user.email ?? '');
  const [jobTitle, setJobTitle] = useState(employee.jobTitle ?? '');
  const [department, setDepartment] = useState<string>(employee.department ?? 'none');
  const [status, setStatus] = useState<string>(employee.isActive ? 'active' : 'inactive');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    employee.employmentType ?? DEFAULT_EMPLOYMENT_TYPE,
  );
  const [contractExpiryDate, setContractExpiryDate] = useState<Date | undefined>(
    employee.contractExpiryDate ? new Date(employee.contractExpiryDate) : undefined,
  );
  const [primaryLocation, setPrimaryLocation] = useState<string | null>(
    employee.primaryLocation ?? null,
  );
  const [onboardDate, setOnboardDate] = useState<Date | undefined>(
    employee.onboardDate ? new Date(employee.onboardDate) : undefined,
  );
  const [offboardDate, setOffboardDate] = useState<Date | undefined>(
    employee.offboardDate ? new Date(employee.offboardDate) : undefined,
  );
  const [isLoading, setIsLoading] = useState(false);
  const api = useApi();

  const isContract = employmentType === 'contract';

  // A permanent member never keeps a contract expiry — the API clears the stored
  // one on the switch, so the form drops it at the same moment.
  const handleEmploymentTypeChange = (value: EmploymentType | null) => {
    if (!value) return;
    setEmploymentType(value);
    if (value !== 'contract') {
      setContractExpiryDate(undefined);
    }
  };

  const pendingUpdate = useMemo(
    () =>
      buildEmployeeUpdate({
        employee,
        values: {
          name,
          email,
          jobTitle,
          department,
          status,
          employmentType,
          contractExpiryDate,
          primaryLocation,
          onboardDate,
          offboardDate,
        },
      }),
    [
      employee,
      name,
      email,
      jobTitle,
      department,
      status,
      employmentType,
      contractExpiryDate,
      primaryLocation,
      onboardDate,
      offboardDate,
    ],
  );

  const hasChanges = Object.keys(pendingUpdate).length > 0;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error('Email is required');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      toast.error('Enter a valid email address');
      return;
    }
    if (isContract && !contractExpiryDate) {
      toast.error('Contract expiry date is required for contract employment');
      return;
    }

    if (!hasChanges) {
      toast.info('No changes to save');
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.patch(`/v1/people/${employee.id}`, pendingUpdate);
      if (response.error) {
        toast.error(response.error || 'Failed to update employee details');
      } else {
        toast.success('Employee details updated successfully');
      }
    } catch {
      toast.error('Failed to update employee details');
    } finally {
      setIsLoading(false);
    }
  };

  return {
    name,
    setName,
    email,
    setEmail,
    jobTitle,
    setJobTitle,
    department,
    setDepartment,
    status,
    setStatus,
    employmentType,
    handleEmploymentTypeChange,
    isContract,
    contractExpiryDate,
    setContractExpiryDate,
    primaryLocation,
    setPrimaryLocation,
    onboardDate,
    setOnboardDate,
    offboardDate,
    setOffboardDate,
    hasChanges,
    isLoading,
    handleSubmit,
  };
}
