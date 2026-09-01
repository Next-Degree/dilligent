'use client';

import { SelectAssignee } from '@/components/SelectAssignee';
import { VENDOR_STATUS_TYPES, VendorStatus } from '@/components/vendor-status';
import type { Member, User } from '@db';
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
import { VENDOR_CATEGORY_OPTIONS, vendorCategoryLabel } from '@trycompai/utils/vendors';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import type { z } from 'zod';
import type { updateVendorSchema } from '../../actions/schema';
import { VendorClassificationFields } from './vendor-classification-fields';

type VendorFormValues = z.infer<typeof updateVendorSchema>;

interface VendorComplianceFieldsProps {
  control: Control<VendorFormValues>;
  errors: FieldErrors<VendorFormValues>;
  assignees: (Member & { user: User })[];
  disabled: boolean;
}

export function VendorComplianceFields({
  control,
  errors,
  assignees,
  disabled,
}: VendorComplianceFieldsProps) {
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
            <FieldDescription>
              IT or compliance member running the risk assessment.
            </FieldDescription>
            <FieldError errors={[errors.assigneeId]} />
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
                {/* A row not yet backfilled can still hold a retired value;
                    `vendorCategoryLabel` renders it as e.g. "SaaS (retired)"
                    rather than leaving the trigger blank. */}
                <SelectValue placeholder="Select a category...">
                  {field.value ? vendorCategoryLabel(field.value) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {VENDOR_CATEGORY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
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

      {/* Checkbox groups need the full row — half a column at md would wrap
          every label. `col-span-2` only applies where the grid has 2 columns. */}
      <div className="md:col-span-2">
        <VendorClassificationFields control={control} disabled={disabled} />
      </div>
    </Grid>
  );
}
