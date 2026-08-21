'use client';

import { SelectAssignee } from '@/components/SelectAssignee';
import { type Member, type User } from '@db';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Grid,
  Input,
} from '@trycompai/design-system';
import { Calendar as CalendarIcon } from '@trycompai/design-system/icons';
import { Calendar } from '@trycompai/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@trycompai/ui/popover';
import { format } from 'date-fns';
import { useState } from 'react';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import type { z } from 'zod';
import type { updateVendorSchema } from '../../actions/schema';
import { parseNumberInput, toInputValue } from './contract-format';
import { VendorCostFields } from './vendor-cost-fields';

type VendorFormValues = z.infer<typeof updateVendorSchema>;

interface VendorManagementFieldsProps {
  control: Control<VendorFormValues>;
  errors: FieldErrors<VendorFormValues>;
  assignees: (Member & { user: User })[];
  disabled: boolean;
}

export function VendorManagementFields({
  control,
  errors,
  assignees,
  disabled,
}: VendorManagementFieldsProps) {
  const [renewalPickerOpen, setRenewalPickerOpen] = useState(false);

  return (
    <Grid cols={{ base: '1', md: '2', xl: '3' }} gap="4">
      <Controller
        control={control}
        name="ownerId"
        render={({ field }) => (
          <Field>
            <FieldLabel>System Owner</FieldLabel>
            <SelectAssignee
              disabled={disabled}
              withTitle={false}
              emptyLabel="No owner"
              assignees={assignees}
              assigneeId={field.value ?? null}
              onAssigneeChange={field.onChange}
            />
            <FieldDescription>
              Internal person in charge of this system day to day.
            </FieldDescription>
            <FieldError errors={[errors.ownerId]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="totalSeats"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="totalSeats">Total Seats</FieldLabel>
            <Input
              id="totalSeats"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="Not set"
              disabled={disabled}
              value={toInputValue(field.value)}
              onChange={(event) => field.onChange(parseNumberInput(event.target.value))}
              onBlur={field.onBlur}
            />
            <FieldError errors={[errors.totalSeats]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="usedSeats"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="usedSeats">Used Seats</FieldLabel>
            <Input
              id="usedSeats"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="Not set"
              disabled={disabled}
              value={toInputValue(field.value)}
              onChange={(event) => field.onChange(parseNumberInput(event.target.value))}
              onBlur={field.onBlur}
            />
            <FieldError errors={[errors.usedSeats]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="renewalDate"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="renewalDate">Renewal Date</FieldLabel>
            <Popover
              open={disabled ? false : renewalPickerOpen}
              onOpenChange={disabled ? undefined : setRenewalPickerOpen}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  id="renewalDate"
                  disabled={disabled}
                  className="border-input dark:bg-input/30 hover:bg-muted disabled:bg-input/50 flex h-8 w-full items-center justify-between gap-2 rounded-sm border bg-transparent px-2.5 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">
                    {field.value ? format(field.value, 'PPP') : 'Not set'}
                  </span>
                  <CalendarIcon size={16} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={field.value ?? undefined}
                  onSelect={(date) => {
                    field.onChange(date ?? null);
                    setRenewalPickerOpen(false);
                  }}
                  captionLayout="dropdown"
                  fromYear={new Date().getFullYear() - 5}
                  toYear={new Date().getFullYear() + 20}
                />
              </PopoverContent>
            </Popover>
            <FieldError errors={[errors.renewalDate]} />
          </Field>
        )}
      />

      <VendorCostFields control={control} errors={errors} disabled={disabled} />

      <Controller
        control={control}
        name="noticePeriodDays"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="noticePeriodDays">Notice Period</FieldLabel>
            <Input
              id="noticePeriodDays"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="Not set"
              disabled={disabled}
              value={toInputValue(field.value)}
              onChange={(event) => field.onChange(parseNumberInput(event.target.value))}
              onBlur={field.onBlur}
            />
            <FieldDescription>Days of notice required to cancel.</FieldDescription>
            <FieldError errors={[errors.noticePeriodDays]} />
          </Field>
        )}
      />
    </Grid>
  );
}
