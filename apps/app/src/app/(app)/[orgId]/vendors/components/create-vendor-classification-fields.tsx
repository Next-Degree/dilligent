'use client';

import { ClassificationMultiSelect } from '@/components/classification-multi-select';
import { FieldError } from '@trycompai/design-system';
import {
  DATA_FLOW_ROLE_OPTIONS,
  DATA_SERVICE_TYPE_OPTIONS,
  VENDOR_DELIVERY_MODEL_OPTIONS,
  isDataCentricVendorCategory,
} from '@trycompai/utils/vendors';
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form';
import { VENDOR_CLASSIFICATION_COPY } from '../vendor-classification-copy';
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
  // `useWatch` rather than `form.watch`: only this subtree needs to re-render
  // when the category changes, not the whole create form.
  const category = useWatch({ control: form.control, name: 'category' });
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
              label={VENDOR_CLASSIFICATION_COPY.deliveryModels.label}
              description={VENDOR_CLASSIFICATION_COPY.deliveryModels.description}
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
                label={VENDOR_CLASSIFICATION_COPY.dataServiceTypes.label}
                description={VENDOR_CLASSIFICATION_COPY.dataServiceTypes.description}
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
                label={VENDOR_CLASSIFICATION_COPY.dataFlowRoles.label}
                description={VENDOR_CLASSIFICATION_COPY.dataFlowRoles.description}
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
