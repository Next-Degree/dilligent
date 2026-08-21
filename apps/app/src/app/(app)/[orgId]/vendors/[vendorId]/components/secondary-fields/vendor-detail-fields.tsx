'use client';

import { SelectAssignee } from '@/components/SelectAssignee';
import { VENDOR_STATUS_TYPES, VendorStatus } from '@/components/vendor-status';
import { VendorCategory, type Member, type User } from '@db';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Grid,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trycompai/design-system';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import type { z } from 'zod';
import type { updateVendorSchema } from '../../actions/schema';

type VendorFormValues = z.infer<typeof updateVendorSchema>;

const formatCategory = (category: VendorCategory) =>
  category
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

interface VendorDetailFieldsProps {
  control: Control<VendorFormValues>;
  errors: FieldErrors<VendorFormValues>;
  assignees: (Member & { user: User })[];
  disabled: boolean;
}

export function VendorDetailFields({
  control,
  errors,
  assignees,
  disabled,
}: VendorDetailFieldsProps) {
  return (
    <Grid cols={{ base: '1', md: '2' }} gap="4">
      <Controller
        control={control}
        name="assigneeId"
        render={({ field }) => (
          <Field>
            <FieldLabel>Assignee</FieldLabel>
            <SelectAssignee
              disabled={disabled}
              withTitle={false}
              assignees={assignees}
              assigneeId={field.value}
              onAssigneeChange={field.onChange}
            />
            <FieldDescription>Drives the security assessment.</FieldDescription>
            <FieldError errors={[errors.assigneeId]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="ownerId"
        render={({ field }) => (
          <Field>
            <FieldLabel>Owner</FieldLabel>
            <SelectAssignee
              disabled={disabled}
              withTitle={false}
              emptyLabel="No owner"
              assignees={assignees}
              assigneeId={field.value ?? null}
              onAssigneeChange={field.onChange}
            />
            <FieldDescription>Owns the commercial relationship.</FieldDescription>
            <FieldError errors={[errors.ownerId]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="status">Status</FieldLabel>
            <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
              <SelectTrigger id="status">
                <SelectValue placeholder="Select a status...">
                  {field.value && <VendorStatus status={field.value} />}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {VENDOR_STATUS_TYPES.map((status) => (
                  <SelectItem key={status} value={status}>
                    <VendorStatus status={status} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={[errors.status]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="category"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="category">Category</FieldLabel>
            <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
              <SelectTrigger id="category">
                <SelectValue placeholder="Select a category..." />
              </SelectTrigger>
              <SelectContent>
                {Object.values(VendorCategory).map((category) => (
                  <SelectItem key={category} value={category}>
                    {formatCategory(category)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={[errors.category]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="website"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="website">Website</FieldLabel>
            <Input
              id="website"
              type="url"
              inputMode="url"
              placeholder="https://example.com"
              disabled={disabled}
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
            <FieldError errors={[errors.website]} />
          </Field>
        )}
      />
    </Grid>
  );
}
