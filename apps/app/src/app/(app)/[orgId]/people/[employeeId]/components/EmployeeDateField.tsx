'use client';

import {
  Calendar,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Stack,
} from '@trycompai/design-system';
import { Calendar as CalendarIcon } from '@trycompai/design-system/icons';
import { format } from 'date-fns';
import { useState } from 'react';

interface EmployeeDateFieldProps {
  id: string;
  label: string;
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  disabled?: boolean;
  /** Latest selectable year; defaults to next year. */
  toYear?: number;
}

/**
 * Labelled date picker used by the employee details form. The trigger is a
 * full-width control so the field lines up with the Input/Select beside it at
 * every breakpoint.
 */
export const EmployeeDateField = ({
  id,
  label,
  value,
  onChange,
  disabled = false,
  toYear,
}: EmployeeDateFieldProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Stack gap="sm">
      <Label htmlFor={id}>{label}</Label>
      <Popover
        open={disabled ? false : isOpen}
        onOpenChange={disabled ? undefined : setIsOpen}
      >
        <PopoverTrigger
          id={id}
          disabled={disabled}
          className="border-border bg-background text-foreground hover:bg-muted flex h-10 w-full items-center justify-between rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {value ? format(value, 'PPP') : 'Not set'}
          <CalendarIcon size={16} />
        </PopoverTrigger>
        <PopoverContent align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(date) => {
              onChange(date ?? undefined);
              setIsOpen(false);
            }}
            captionLayout="dropdown"
            fromYear={2000}
            toYear={toYear ?? new Date().getFullYear() + 1}
          />
        </PopoverContent>
      </Popover>
    </Stack>
  );
};
