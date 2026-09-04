'use client';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Stack,
} from '@trycompai/design-system';
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
            idPrefix="vendor"
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
            idPrefix="vendor"
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
            idPrefix="vendor"
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
          <div className="text-muted-foreground text-sm underline underline-offset-4">
            <CollapsibleTrigger>Data handling (optional)</CollapsibleTrigger>
          </div>
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
