'use client';

import { ClassificationMultiSelect } from '@/components/classification-multi-select';
import { FieldError } from '@trycompai/design-system';
import {
  DATA_FLOW_ROLE_OPTIONS,
  DATA_SERVICE_TYPE_OPTIONS,
  VENDOR_DELIVERY_MODEL_OPTIONS,
  isDataCentricVendorCategory,
} from '@trycompai/utils/vendors';
import { Controller, type UseFormReturn } from 'react-hook-form';
import type { CreateVendorFormValues } from './create-vendor-form-schema';

type Props = {
  form: UseFormReturn<CreateVendorFormValues>;
};

/**
 * The three "how / what data" dimensions of the vendor classification.
 *
 * `deliveryModels` is always asked — it is what ISMS scoping reads. The two data
 * dimensions only appear once the chosen category is one whose whole purpose is
 * data (`data_provider`, `data_enrichment`, `data_collection`); asking every
 * vendor what kind of data it sells produced noise, not answers.
 */
export function CreateVendorClassificationFields({ form }: Props) {
  const category = form.watch('category');
  const showDataFields = isDataCentricVendorCategory(category);
  const { errors } = form.formState;

  return (
    <>
      <Controller
        control={form.control}
        name="deliveryModels"
        render={({ field }) => (
          <div>
            <ClassificationMultiSelect
              id="create-vendor-delivery-models"
              label="Delivery Models"
              description="How we consume this vendor. Pick every model that applies."
              options={VENDOR_DELIVERY_MODEL_OPTIONS}
              value={field.value}
              onChange={field.onChange}
            />
            <FieldError errors={[errors.deliveryModels]} />
          </div>
        )}
      />

      {showDataFields && (
        <>
          <Controller
            control={form.control}
            name="dataServiceTypes"
            render={({ field }) => (
              <ClassificationMultiSelect
                id="create-vendor-data-service-types"
                label="Data Service Types"
                description="What kind of data this vendor deals in."
                options={DATA_SERVICE_TYPE_OPTIONS}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />

          <Controller
            control={form.control}
            name="dataFlowRoles"
            render={({ field }) => (
              <ClassificationMultiSelect
                id="create-vendor-data-flow-roles"
                label="Data Flow Roles"
                description="Where this vendor sits in our data flow."
                options={DATA_FLOW_ROLE_OPTIONS}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </>
      )}
    </>
  );
}
