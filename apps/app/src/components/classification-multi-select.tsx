'use client';

import {
  Checkbox,
  Field,
  FieldDescription,
  FieldLabel,
  Grid,
  Label,
} from '@trycompai/design-system';
import { useId } from 'react';

export interface ClassificationMultiSelectOption {
  value: string;
  label: string;
}

/**
 * Add or remove `value` from `list`, returning a new array.
 *
 * Shared with the vendors toolbar filter, which renders its own narrow popover
 * layout but needs exactly this add-if-ticked / drop-if-unticked behaviour.
 */
export function toggleValue({
  list,
  value,
  isSelected,
}: {
  list: string[];
  value: string;
  isSelected: boolean;
}): string[] {
  if (isSelected) return [...list, value];
  return list.filter((entry) => entry !== value);
}

interface ClassificationMultiSelectProps {
  /** The full set of selectable values, already labelled (e.g. `VENDOR_CATEGORY_OPTIONS`). */
  options: ClassificationMultiSelectOption[];
  /** The currently-selected subset. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Names the whole group — this is a set of choices, not a single control. */
  label: string;
  description?: string;
  /** Stable id root, so the ids survive re-renders in tests and label targets. */
  id?: string;
}

/**
 * Multi-value picker for the vendor classification enums (delivery models, data
 * service types, data flow roles). The design system has no multi-select, and a
 * dropdown would hide the options behind a click — these vocabularies are short
 * and the user is choosing several, so every option stays visible as a real
 * checkbox in a responsive grid (1 column on phones, 2 on tablets, 3 on desktop).
 *
 * Built from design-system primitives only, following the checkbox-group
 * precedent in `documents/isms/wizard/WizardCheckboxList`.
 */
export function ClassificationMultiSelect({
  options,
  value,
  onChange,
  disabled = false,
  label,
  description,
  id,
}: ClassificationMultiSelectProps) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const labelId = `${groupId}-label`;
  const descriptionId = `${groupId}-description`;

  // Form state can genuinely arrive undefined; never assume an array.
  const selected = Array.isArray(value) ? value : [];

  const handleToggle = ({
    optionValue,
    isChecked,
  }: {
    optionValue: string;
    isChecked: boolean;
  }) => {
    onChange(toggleValue({ list: selected, value: optionValue, isSelected: isChecked }));
  };

  return (
    <Field
      aria-labelledby={labelId}
      aria-describedby={description ? descriptionId : undefined}
      data-disabled={disabled ? 'true' : undefined}
    >
      <FieldLabel id={labelId}>{label}</FieldLabel>
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      <Grid cols={{ base: '1', md: '2', xl: '3' }} gap="2">
        {options.map((option) => {
          const optionId = `${groupId}-${option.value}`;
          return (
            // min-h-10 keeps the touch target usable on phones; min-w-0 lets the
            // long labels ("Collaboration & Productivity") wrap instead of
            // pushing the grid wider than the viewport.
            <div key={option.value} className="flex min-h-10 min-w-0 items-center gap-2">
              <Checkbox
                id={optionId}
                disabled={disabled}
                checked={selected.includes(option.value)}
                onCheckedChange={(next) =>
                  handleToggle({ optionValue: option.value, isChecked: next })
                }
                aria-label={option.label}
              />
              <div className="min-w-0">
                <Label htmlFor={optionId}>{option.label}</Label>
              </div>
            </div>
          );
        })}
      </Grid>
    </Field>
  );
}
