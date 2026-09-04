'use client';

import { ClassificationMultiSelect } from '@/components/classification-multi-select';
import {
  DATA_FLOW_ROLE_OPTIONS,
  DATA_SERVICE_TYPE_OPTIONS,
  VENDOR_DELIVERY_MODEL_OPTIONS,
} from '@trycompai/utils/vendors';
import { VENDOR_CLASSIFICATION_COPY } from './vendor-classification-copy';

/**
 * Each list dimension paired with the options it offers. The pairing lives here
 * because nothing in the type system stops a hand-written control from putting
 * `DATA_FLOW_ROLE_OPTIONS` under the "Data Service Types" label — both are
 * `ClassificationOption<string>[]` — and the create and edit forms were making
 * that pairing independently, six times over.
 */
const VENDOR_DIMENSIONS = {
  deliveryModels: {
    ...VENDOR_CLASSIFICATION_COPY.deliveryModels,
    options: VENDOR_DELIVERY_MODEL_OPTIONS,
  },
  dataServiceTypes: {
    ...VENDOR_CLASSIFICATION_COPY.dataServiceTypes,
    options: DATA_SERVICE_TYPE_OPTIONS,
  },
  dataFlowRoles: {
    ...VENDOR_CLASSIFICATION_COPY.dataFlowRoles,
    options: DATA_FLOW_ROLE_OPTIONS,
  },
} as const;

export type VendorDimensionName = keyof typeof VENDOR_DIMENSIONS;

const DIMENSION_ID_SUFFIX: Record<VendorDimensionName, string> = {
  deliveryModels: 'delivery-models',
  dataServiceTypes: 'data-service-types',
  dataFlowRoles: 'data-flow-roles',
};

interface VendorDimensionFieldProps {
  dimension: VendorDimensionName;
  /** Namespaces the control id, so the two forms can coexist on one page. */
  idPrefix: string;
  value: readonly string[] | null | undefined;
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

/**
 * One classification dimension as a labelled multi-select. Deliberately
 * presentational: the caller owns the `Controller`, so each form keeps its own
 * field typing, and only the label/description/options triple is shared.
 */
export function VendorDimensionField({
  dimension,
  idPrefix,
  value,
  onChange,
  disabled,
}: VendorDimensionFieldProps) {
  const { label, description, options } = VENDOR_DIMENSIONS[dimension];

  return (
    <ClassificationMultiSelect
      id={`${idPrefix}-${DIMENSION_ID_SUFFIX[dimension]}`}
      label={label}
      description={description}
      options={options}
      value={value ?? []}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
