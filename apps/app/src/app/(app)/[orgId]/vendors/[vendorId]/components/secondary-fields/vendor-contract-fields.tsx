'use client';

import { VendorContractTerm } from '@db';
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
import { Calendar as CalendarIcon } from '@trycompai/design-system/icons';
// The design-system does ship a Calendar, but its PopoverContent is locked to
// `w-72` with `p-2.5` and Omits `className`, while the calendar can't shrink
// below `min-w-[280px]` — so it renders with the right gutter eaten and the
// last day column against the border. Until PopoverContent takes a width,
// every date picker in this app pairs the legacy Popover with the legacy
// Calendar (EmployeeDetails, create-vendor-task-form, the data-table
// filters); this one matches.
import { Calendar } from '@trycompai/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@trycompai/ui/popover';
import { format } from 'date-fns';
import { useState } from 'react';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import type { z } from 'zod';
import type { updateVendorSchema } from '../../actions/schema';
import { parseNumberInput, toInputValue } from './contract-format';

type VendorFormValues = z.infer<typeof updateVendorSchema>;

const CONTRACT_TERM_LABELS: Record<VendorContractTerm, string> = {
  [VendorContractTerm.monthly]: 'Monthly',
  [VendorContractTerm.yearly]: 'Yearly',
};

/** Sentinel for the "not recorded" option — Select can't hold an empty value. */
const NOT_SET = 'not_set';

interface VendorContractFieldsProps {
  control: Control<VendorFormValues>;
  errors: FieldErrors<VendorFormValues>;
  disabled: boolean;
}

export function VendorContractFields({ control, errors, disabled }: VendorContractFieldsProps) {
  const [renewalPickerOpen, setRenewalPickerOpen] = useState(false);

  return (
    <Grid cols={{ base: '1', md: '2', xl: '3' }} gap="4">
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

      <Controller
        control={control}
        name="annualCost"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="annualCost">Annual Cost</FieldLabel>
            <Input
              id="annualCost"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="Not set"
              disabled={disabled}
              value={toInputValue(field.value)}
              onChange={(event) => field.onChange(parseNumberInput(event.target.value))}
              onBlur={field.onBlur}
            />
            <FieldDescription>Total annual spend, in USD.</FieldDescription>
            <FieldError errors={[errors.annualCost]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="contractTerm"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="contractTerm">Contract Term</FieldLabel>
            <Select
              value={field.value ?? NOT_SET}
              onValueChange={(value) => field.onChange(value === NOT_SET ? null : value)}
              disabled={disabled}
            >
              <SelectTrigger id="contractTerm">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_SET}>Not set</SelectItem>
                {Object.values(VendorContractTerm).map((term) => (
                  <SelectItem key={term} value={term}>
                    {CONTRACT_TERM_LABELS[term]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={[errors.contractTerm]} />
          </Field>
        )}
      />

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
