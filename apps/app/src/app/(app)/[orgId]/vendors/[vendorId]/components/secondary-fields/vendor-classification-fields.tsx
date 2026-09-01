'use client';

import { ClassificationMultiSelect } from '@/components/classification-multi-select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Stack,
} from '@trycompai/design-system';
import {
  DATA_FLOW_ROLE_OPTIONS,
  DATA_SERVICE_TYPE_OPTIONS,
  VENDOR_DELIVERY_MODEL_OPTIONS,
  isDataCentricVendorCategory,
} from '@trycompai/utils/vendors';
import { Controller, useWatch, type Control } from 'react-hook-form';
import type { z } from 'zod';
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
          <ClassificationMultiSelect
            id="vendor-data-service-types"
            label="Data Service Types"
            description="What kind of data this vendor deals in."
            options={DATA_SERVICE_TYPE_OPTIONS}
            value={field.value ?? []}
            onChange={field.onChange}
            disabled={disabled}
          />
        )}
      />
      <Controller
        control={control}
        name="dataFlowRoles"
        render={({ field }) => (
          <ClassificationMultiSelect
            id="vendor-data-flow-roles"
            label="Data Flow Roles"
            description="Where this vendor sits in our data flow — a vendor may hold several roles."
            options={DATA_FLOW_ROLE_OPTIONS}
            value={field.value ?? []}
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
export function VendorClassificationFields({
  control,
  disabled,
}: VendorClassificationFieldsProps) {
  const category = useWatch({ control, name: 'category' });
  const isDataCentric = isDataCentricVendorCategory(category);

  return (
    <Stack gap="4">
      <Controller
        control={control}
        name="deliveryModels"
        render={({ field }) => (
          <ClassificationMultiSelect
            id="vendor-delivery-models"
            label="Delivery Models"
            description="How we consume this vendor. Drives whether the ISMS treats it as externally hosted."
            options={VENDOR_DELIVERY_MODEL_OPTIONS}
            value={field.value ?? []}
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
