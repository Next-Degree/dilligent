'use client';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Stack,
} from '@trycompai/design-system';
import { ChevronRight } from '@trycompai/design-system/icons';
import { isDataCentricVendorCategory } from '@trycompai/utils/vendors';
import { Controller, useWatch, type Control } from 'react-hook-form';
import type { z } from 'zod';
import { VendorDimensionField } from '../../../vendor-dimension-field';
import type { updateVendorSchema } from '../../actions/schema';

type VendorFormValues = z.infer<typeof updateVendorSchema>;

interface VendorClassificationFieldsProps {
  control: Control<VendorFormValues>;
  disabled: boolean;
}

/** The two data dimensions, shared by the prominent and the disclosed layout. */
function DataDimensionFields({ control, disabled }: VendorClassificationFieldsProps) {
  return (
    <Stack gap="4">
      <Controller
        control={control}
        name="dataServiceTypes"
        render={({ field }) => (
          <VendorDimensionField
            dimension="dataServiceTypes"
            value={field.value}
            onChange={field.onChange}
            disabled={disabled}
          />
        )}
      />
      <Controller
        control={control}
        name="dataFlowRoles"
        render={({ field }) => (
          <VendorDimensionField
            dimension="dataFlowRoles"
            value={field.value}
            onChange={field.onChange}
            disabled={disabled}
          />
        )}
      />
    </Stack>
  );
}

/**
 * Delivery models plus, for data vendors, the two data dimensions.
 *
 * For `data_provider` / `data_enrichment` / `data_collection` the data questions
 * ARE the assessment, so they render as ordinary always-visible fields. For every
 * other category they are usually empty, so they stay reachable behind a
 * disclosure rather than adding fifteen unread checkboxes to the form.
 */
export function VendorClassificationFields({ control, disabled }: VendorClassificationFieldsProps) {
  const category = useWatch({ control, name: 'category' });
  const isDataCentric = isDataCentricVendorCategory(category);

  return (
    <Stack gap="4">
      <Controller
        control={control}
        name="deliveryModels"
        render={({ field }) => (
          <VendorDimensionField
            dimension="deliveryModels"
            value={field.value}
            onChange={field.onChange}
            disabled={disabled}
          />
        )}
      />

      {isDataCentric ? (
        <DataDimensionFields control={control} disabled={disabled} />
      ) : (
        <Collapsible>
          {/* A bare underlined caption read as dead text, so the section looked
              empty rather than closed. The chevron is the affordance; base-ui
              flags the open state on the trigger as `data-panel-open`. */}
          {/* min-h-10 keeps it a real touch target on phones — the text alone
              is half that. Hover only deepens the colour; the chevron and the
              underline carry the affordance where there is no pointer. */}
          <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex min-h-10 items-center gap-1.5 text-sm">
            <ChevronRight
              size={16}
              className="transition-transform group-data-panel-open:rotate-90"
            />
            <span className="underline underline-offset-4">Data handling (optional)</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="pt-4">
              <DataDimensionFields control={control} disabled={disabled} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Stack>
  );
}
