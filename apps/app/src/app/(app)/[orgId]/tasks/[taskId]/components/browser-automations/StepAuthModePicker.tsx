'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trycompai/design-system';
import type { BrowserStepAuthMode } from '../../hooks/types';
import { AUTH_MODE_LABELS, PUBLIC_MODE, SAVED_SESSION_MODE } from './step-auth-mode';

interface StepAuthModePickerProps {
  value: BrowserStepAuthMode;
  onChange: (authMode: BrowserStepAuthMode) => void;
}

const MODES: BrowserStepAuthMode[] = [SAVED_SESSION_MODE, PUBLIC_MODE];

const isAuthMode = (value: string | null): value is BrowserStepAuthMode =>
  value !== null && (MODES as string[]).includes(value);

/**
 * Whether a step signs in first or just opens a public page. Kept separate from
 * the connection picker: the two aren't one list, and a sentinel option inside
 * the connection picker would resolve to a real connection on any unmatched id.
 */
export function StepAuthModePicker({ value, onChange }: StepAuthModePickerProps) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isAuthMode(next)) onChange(next);
      }}
    >
      <SelectTrigger aria-label="How this step signs in">
        <SelectValue placeholder="How this step signs in">
          {(selectedValue: string | null) =>
            isAuthMode(selectedValue)
              ? AUTH_MODE_LABELS[selectedValue]
              : AUTH_MODE_LABELS[SAVED_SESSION_MODE]
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {MODES.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {AUTH_MODE_LABELS[mode]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
