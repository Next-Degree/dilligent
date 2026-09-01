'use client';

import { CountrySelect } from '@/components/CountrySelect';
import { DepartmentSelect } from '@/components/DepartmentSelect';
import type { Member, User } from '@db';
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
import { EMPLOYMENT_TYPE_OPTIONS, getEmploymentTypeLabel } from '../../employment';
import { useEmployeeDetailsForm } from '../hooks/useEmployeeDetailsForm';
import { EmployeeDateField } from './EmployeeDateField';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export const EmployeeDetails = ({
  employee,
  canEdit,
}: {
  employee: Member & {
    user: User;
  };
  canEdit: boolean;
}) => {
  const form = useEmployeeDetailsForm(employee);

  return (
    <Section>
      <form onSubmit={form.handleSubmit}>
        <Stack gap="md">
          <Grid cols={{ base: '1', md: '2' }} gap="4">
            {/* Name Field */}
            <Stack gap="sm">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
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
                value={form.email}
                onChange={(e) => form.setEmail(e.target.value)}
                placeholder="employee@example.com"
                disabled={!canEdit}
              />
            </Stack>

            {/* Job Title Field */}
            <Stack gap="sm">
              <Label htmlFor="jobTitle">Job Title</Label>
              <Input
                id="jobTitle"
                value={form.jobTitle}
                onChange={(e) => form.setJobTitle(e.target.value)}
                placeholder="e.g. Software Engineer"
                disabled={!canEdit}
              />
            </Stack>

            {/* Department Field */}
            <Stack gap="sm">
              <Label htmlFor="department">Department</Label>
              <DepartmentSelect
                value={form.department}
                onChange={form.setDepartment}
                disabled={!canEdit}
              />
            </Stack>

            {/* Primary Location Field */}
            <Stack gap="sm">
              <Label htmlFor="primaryLocation">Primary Location</Label>
              <CountrySelect
                id="primaryLocation"
                value={form.primaryLocation}
                onChange={form.setPrimaryLocation}
                disabled={!canEdit}
                placeholder="Search countries"
              />
            </Stack>

            {/* Employment Type Field */}
            <Stack gap="sm">
              <Label htmlFor="employmentType">Employment Type</Label>
              <Select
                value={form.employmentType}
                disabled={!canEdit}
                onValueChange={form.handleEmploymentTypeChange}
              >
                <SelectTrigger id="employmentType">
                  <SelectValue placeholder="Select employment type">
                    {getEmploymentTypeLabel(form.employmentType)}
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
            {form.isContract && (
              <EmployeeDateField
                id="contractExpiryDate"
                label="Contract Expiry Date"
                value={form.contractExpiryDate}
                onChange={form.setContractExpiryDate}
                disabled={!canEdit}
                toYear={new Date().getFullYear() + 10}
              />
            )}

            {/* Status Field */}
            <Stack gap="sm">
              <Label htmlFor="status">Status</Label>
              <Select
                value={form.status}
                disabled={!canEdit}
                onValueChange={(value) => value && form.setStatus(value)}
              >
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status">
                    {STATUS_OPTIONS.find((s) => s.value === form.status)?.label ?? 'Active'}
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
              value={form.onboardDate}
              onChange={form.setOnboardDate}
              disabled={!canEdit}
            />

            <EmployeeDateField
              id="offboardDate"
              label="Offboard Date"
              value={form.offboardDate}
              onChange={form.setOffboardDate}
              disabled={!canEdit}
            />
          </Grid>

          <HStack justify="end">
            <Button
              type="submit"
              disabled={!form.hasChanges || form.isLoading || !canEdit}
              loading={form.isLoading}
            >
              Save
            </Button>
          </HStack>
        </Stack>
      </form>
    </Section>
  );
};
