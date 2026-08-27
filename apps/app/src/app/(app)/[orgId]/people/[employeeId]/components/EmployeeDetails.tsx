'use client';

import { DepartmentSelect } from '@/components/DepartmentSelect';
import { useApi } from '@/hooks/use-api';
import type { EmploymentType, Member, User } from '@db';
import {
  Button,
  Grid,
  HStack,
  Input,
  Label,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
} from '@trycompai/design-system';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_EMPLOYMENT_TYPE,
  EMPLOYMENT_TYPE_OPTIONS,
  getEmploymentTypeLabel,
} from '../../employment';
import { EmployeeDateField } from './EmployeeDateField';
import { buildEmployeeUpdate } from './employee-update';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

// Mirrors the backend's @IsEmail() on UpdatePeopleDto.email so the form rejects
// values the PATCH /v1/people/:id endpoint would reject anyway.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value: string) => EMAIL_REGEX.test(value);

export const EmployeeDetails = ({
  employee,
  canEdit,
}: {
  employee: Member & {
    user: User;
  };
  canEdit: boolean;
}) => {
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

  return (
    <Section>
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Grid cols={{ base: '1', md: '2' }} gap="4">
            {/* Name Field */}
            <Stack gap="sm">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Employee name"
                disabled={!canEdit}
              />
            </Stack>

            {/* Email Field (login email) */}
            <Stack gap="sm">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="employee@example.com"
                disabled={!canEdit}
              />
            </Stack>

            {/* Job Title Field */}
            <Stack gap="sm">
              <Label htmlFor="jobTitle">Job Title</Label>
              <Input
                id="jobTitle"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Software Engineer"
                disabled={!canEdit}
              />
            </Stack>

            {/* Department Field */}
            <Stack gap="sm">
              <Label htmlFor="department">Department</Label>
              <DepartmentSelect
                value={department}
                onChange={setDepartment}
                disabled={!canEdit}
              />
            </Stack>

            {/* Employment Type Field */}
            <Stack gap="sm">
              <Label htmlFor="employmentType">Employment Type</Label>
              <Select
                value={employmentType}
                disabled={!canEdit}
                onValueChange={handleEmploymentTypeChange}
              >
                <SelectTrigger id="employmentType">
                  <SelectValue placeholder="Select employment type">
                    {getEmploymentTypeLabel(employmentType)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Stack>

            {/* Contract Expiry Field — contract members only */}
            {isContract && (
              <EmployeeDateField
                id="contractExpiryDate"
                label="Contract Expiry Date"
                value={contractExpiryDate}
                onChange={setContractExpiryDate}
                disabled={!canEdit}
                toYear={new Date().getFullYear() + 10}
              />
            )}

            {/* Status Field */}
            <Stack gap="sm">
              <Label htmlFor="status">Status</Label>
              <Select
                value={status}
                disabled={!canEdit}
                onValueChange={(value) => value && setStatus(value)}
              >
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status">
                    {STATUS_OPTIONS.find((s) => s.value === status)?.label ?? 'Active'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Stack>

            <EmployeeDateField
              id="onboardDate"
              label="Onboard Date"
              value={onboardDate}
              onChange={setOnboardDate}
              disabled={!canEdit}
            />

            <EmployeeDateField
              id="offboardDate"
              label="Offboard Date"
              value={offboardDate}
              onChange={setOffboardDate}
              disabled={!canEdit}
            />
          </Grid>

          <HStack justify="end">
            <Button
              type="submit"
              disabled={!hasChanges || isLoading || !canEdit}
              loading={isLoading}
            >
              Save
            </Button>
          </HStack>
        </Stack>
      </form>
    </Section>
  );
};
