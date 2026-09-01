'use client';

import {
  Button,
  Checkbox,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Text,
} from '@trycompai/design-system';
import { Filter } from '@trycompai/design-system/icons';
import { VENDOR_CATEGORY_OPTIONS } from '@trycompai/utils/vendors';

interface VendorCategoryFilterProps {
  /** Currently-selected category values. Empty means "no filter". */
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * Toolbar filter for the vendors table.
 *
 * Nineteen categories is too many for a row of chips, so they live in a popover
 * — `PopoverContent` is a fixed 288px, which fits inside a 375px viewport, and
 * the list scrolls rather than growing the page. This is deliberately NOT the
 * shared `ClassificationMultiSelect`: that component lays its options out in a
 * viewport-driven grid, which would try to render three columns inside this
 * popover on desktop.
 */
export function VendorCategoryFilter({ value, onChange }: VendorCategoryFilterProps) {
  const selected = Array.isArray(value) ? value : [];

  const handleToggle = ({ category, isChecked }: { category: string; isChecked: boolean }) => {
    if (isChecked) {
      if (selected.includes(category)) return;
      onChange([...selected, category]);
      return;
    }
    onChange(selected.filter((entry) => entry !== category));
  };

  const handleClear = () => onChange([]);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="lg" iconLeft={<Filter size={16} />}>
            {selected.length > 0 ? `Category (${selected.length})` : 'Category'}
          </Button>
        }
      />
      <PopoverContent align="start">
        <div className="flex items-center justify-between gap-2">
          <Text size="sm" weight="medium">
            Filter by category
          </Text>
          {selected.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClear}>
              Clear
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          <ul className="flex flex-col gap-1">
            {VENDOR_CATEGORY_OPTIONS.map((option) => {
              const optionId = `vendor-category-filter-${option.value}`;
              return (
                <li key={option.value} className="flex min-h-10 items-center gap-2">
                  <Checkbox
                    id={optionId}
                    checked={selected.includes(option.value)}
                    onCheckedChange={(next) =>
                      handleToggle({ category: option.value, isChecked: next })
                    }
                    aria-label={option.label}
                  />
                  <Label htmlFor={optionId}>{option.label}</Label>
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
