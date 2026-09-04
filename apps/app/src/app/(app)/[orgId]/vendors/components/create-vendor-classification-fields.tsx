'use client';

import { FieldError } from '@trycompai/design-system';
import { isDataCentricVendorCategory } from '@trycompai/utils/vendors';
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form';
import { VendorDimensionField } from '../vendor-dimension-field';
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
            <VendorDimensionField
              dimension="deliveryModels"
              idPrefix="create-vendor"
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
              <VendorDimensionField
                dimension="dataServiceTypes"
                idPrefix="create-vendor"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />

          <Controller
            control={form.control}
            name="dataFlowRoles"
            render={({ field }) => (
              <VendorDimensionField
                dimension="dataFlowRoles"
                idPrefix="create-vendor"
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
