'use client';

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import type * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { cn } from '../utils';
import { buttonVariants } from './button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// react-day-picker 9+ puts the modifier class names (selected, range_*, outside, ...) on the
// day cell (td) and renders the clickable element as a nested button, so the button is styled
// through the `group` class on the cell.
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn('p-3', className)}
      classNames={{
        months: 'relative flex flex-col sm:flex-row gap-4',
        month: 'flex flex-col gap-4',
        month_caption: 'flex justify-center pt-1 relative items-center h-7',
        dropdowns: 'flex h-7 w-full items-center justify-center gap-1.5 text-sm font-medium',
        dropdown_root:
          'relative rounded-md border border-input shadow-xs has-focus:border-ring has-focus:ring-[3px] has-focus:ring-ring/50',
        dropdown: 'absolute inset-0 bg-popover opacity-0',
        caption_label: cn(
          'select-none text-sm font-medium',
          captionLayout && captionLayout !== 'label'
            ? 'flex h-7 items-center gap-1 rounded-md pl-2 pr-1 [&>svg]:size-3.5 [&>svg]:text-muted-foreground'
            : '',
        ),
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous: cn(
          buttonVariants({ variant: 'outline' }),
          'z-10 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100',
        ),
        button_next: cn(
          buttonVariants({ variant: 'outline' }),
          'z-10 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100',
        ),
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-sm w-9 font-normal text-[0.8rem]',
        week: 'flex w-full mt-2',
        day: 'group h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-9 w-9 p-0 font-normal',
          'group-[.is-selected]:bg-primary group-[.is-selected]:text-primary-foreground group-[.is-selected]:opacity-100',
          'group-[.is-selected]:hover:bg-primary group-[.is-selected]:hover:text-primary-foreground',
          'group-[.is-range-middle]:bg-accent group-[.is-range-middle]:text-accent-foreground',
        ),
        selected: 'is-selected',
        range_start: 'rounded-l-md',
        range_middle: 'is-range-middle bg-accent rounded-none',
        range_end: 'rounded-r-md',
        today: 'bg-accent text-accent-foreground rounded-md',
        outside:
          'text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === 'left') return <ChevronLeft className="h-4 w-4" />;
          if (orientation === 'right') return <ChevronRight className="h-4 w-4" />;
          if (orientation === 'up') return <ChevronUp className="h-4 w-4" />;
          return <ChevronDown className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
