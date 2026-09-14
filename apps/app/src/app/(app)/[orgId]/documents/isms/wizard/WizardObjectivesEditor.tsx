'use client';

import { Button, Input, Label, Stack, Text } from '@trycompai/design-system';
import { Add, TrashCan } from '@trycompai/design-system/icons';
import { useState } from 'react';

export interface WizardObjective {
  objective: string;
  target: string;
}

interface WizardObjectivesEditorProps {
  items: WizardObjective[];
  onChange: (next: WizardObjective[]) => void;
}

const newRowId = () => `obj-${crypto.randomUUID()}`;

/**
 * Return `ids` unchanged when it already has one entry per row, otherwise a new
 * array grown with fresh ids / truncated to `count`.
 */
const alignIds = ({ ids, count }: { ids: string[]; count: number }): string[] => {
  if (ids.length === count) return ids;
  if (ids.length > count) return ids.slice(0, count);
  return [...ids, ...Array.from({ length: count - ids.length }, newRowId)];
};

/**
 * Q11: confirm/override the ~6 default information security objectives and their
 * targets in place. Each row is an editable objective + target pair; rows can be
 * added or removed. The committed list lives in the parent React Hook Form state.
 *
 * The objective data shape has no id, so we keep a parallel list of stable row
 * ids (in state) aligned to `items` by position. Keying on these instead of the
 * array index keeps focus/cursor on the right input when a row is removed.
 */
export function WizardObjectivesEditor({ items, onChange }: WizardObjectivesEditorProps) {
  const rows = Array.isArray(items) ? items : [];

  // Keep one stable id per row, aligned by index, so React reconciles by
  // identity rather than position. Grow/shrink to match the current row count
  // (handles defaults arriving after mount and external resets) by adjusting
  // state during render, which React re-runs before committing.
  const [storedIds, setStoredIds] = useState<string[]>(() => rows.map(newRowId));
  const ids = alignIds({ ids: storedIds, count: rows.length });
  if (ids !== storedIds) setStoredIds(ids);

  const handleField = ({
    index,
    field,
    text,
  }: {
    index: number;
    field: keyof WizardObjective;
    text: string;
  }) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: text } : row)));
  };

  const handleRemove = (index: number) => {
    setStoredIds(ids.filter((_, i) => i !== index));
    onChange(rows.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    setStoredIds([...ids, newRowId()]);
    onChange([...rows, { objective: '', target: '' }]);
  };

  return (
    <Stack gap="3">
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-4 text-center">
          <Text size="sm" variant="muted">
            No objectives yet. Add at least one.
          </Text>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li
              key={ids[index]}
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor={`objective-${ids[index]}`}>Objective</Label>
                <Input
                  id={`objective-${ids[index]}`}
                  value={row.objective}
                  onChange={(event) =>
                    handleField({ index, field: 'objective', text: event.target.value })
                  }
                  placeholder="e.g. Maintain availability of customer-facing services"
                  aria-label={`Objective ${index + 1}`}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`target-${ids[index]}`}>Target</Label>
                <Input
                  id={`target-${ids[index]}`}
                  value={row.target}
                  onChange={(event) =>
                    handleField({ index, field: 'target', text: event.target.value })
                  }
                  placeholder="e.g. 99.9% uptime measured monthly"
                  aria-label={`Target ${index + 1}`}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(index)}
                  iconLeft={<TrashCan size={16} />}
                  aria-label={`Remove objective ${index + 1}`}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handleAdd}
          iconLeft={<Add size={16} />}
        >
          Add objective
        </Button>
      </div>
    </Stack>
  );
}
