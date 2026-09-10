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
  /** One sentence saying what the option means, shown under its label. */
  description?: string;
  /** Heading this option groups under. Unset options render without one. */
  section?: string;
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

interface OptionSection {
  /** Undefined for options that sit under no heading — `other`, and every
   *  vocabulary that asks a single question. */
  name?: string;
  options: ClassificationMultiSelectOption[];
}

/**
 * Split the options into consecutive runs sharing a section. Runs rather than a
 * lookup by name, so the caller's ordering is the rendered ordering and an
 * unsectioned tail (`other`) keeps its place at the end instead of being hoisted.
 */
function toSections(options: ClassificationMultiSelectOption[]): OptionSection[] {
  const sections: OptionSection[] = [];

  for (const option of options) {
    const current = sections.at(-1);
    if (current && current.name === option.section) current.options.push(option);
    else sections.push({ name: option.section, options: [option] });
  }

  return sections;
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
      {toSections(options).map((section, index) => {
        const headingId = section.name ? `${groupId}-section-${index}` : undefined;
        const grid = (
          <Grid cols={{ base: '1', md: '2', xl: '3' }} gap="2">
            {section.options.map((option) => (
              <OptionRow
                key={option.value}
                option={option}
                optionId={`${groupId}-${option.value}`}
                checked={selected.includes(option.value)}
                disabled={disabled}
                onToggle={(isChecked) => handleToggle({ optionValue: option.value, isChecked })}
              />
            ))}
          </Grid>
        );

        // Unsectioned vocabularies render exactly as before: one grid, no heading.
        if (!section.name) return <div key={index}>{grid}</div>;

        return (
          <div key={index} role="group" aria-labelledby={headingId} className="mt-1">
            <p
              id={headingId}
              className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase"
            >
              {section.name}
            </p>
            {grid}
          </div>
        );
      })}
    </Field>
  );
}

interface OptionRowProps {
  option: ClassificationMultiSelectOption;
  optionId: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (isChecked: boolean) => void;
}

function OptionRow({ option, optionId, checked, disabled, onToggle }: OptionRowProps) {
  const descriptionId = option.description ? `${optionId}-description` : undefined;

  return (
    // min-h-10 keeps the touch target usable on phones; min-w-0 lets the long
    // labels ("Collaboration & Productivity") wrap instead of pushing the grid
    // wider than the viewport. items-start so the box stays beside the label
    // once a description stacks underneath it.
    <div className="flex min-h-10 min-w-0 items-start gap-2">
      {/* The design-system Checkbox takes no className, so the nudge that
          optically centres it against the first line of text lives here. */}
      <div className="pt-0.5">
        <Checkbox
          id={optionId}
          disabled={disabled}
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={option.label}
          aria-describedby={descriptionId}
        />
      </div>
      <div className="min-w-0">
        <Label htmlFor={optionId}>{option.label}</Label>
        {option.description ? (
          <p
            id={descriptionId}
            className="text-muted-foreground mt-1 text-xs leading-snug text-balance"
          >
            {option.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
