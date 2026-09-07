'use client';

import { ClassificationMultiSelect } from '@/components/classification-multi-select';
import {
  DATA_FLOW_ROLE_OPTIONS,
  DATA_SERVICE_TYPE_OPTIONS,
  VENDOR_DELIVERY_MODEL_OPTIONS,
} from '@trycompai/utils/vendors';

/**
 * Each list dimension: what to call it, how to explain it, and which options it
 * offers. One table because nothing in the type system stops a hand-written
 * control from putting `DATA_FLOW_ROLE_OPTIONS` under the "Data Service Types"
 * label — both are `ClassificationOption<string>[]` — and the create sheet and the
 * vendor edit form were making that pairing independently, six times between them.
 *
 * The two forms lay these out differently (create hides the data pair until the
 * category is data-centric, edit tucks it behind a disclosure) but ask the same
 * questions, so the wording lives here rather than drifting apart in both.
 */
const VENDOR_DIMENSIONS = {
  deliveryModels: {
    label: 'Delivery Models',
    description:
      'How we consume this vendor. Drives whether the ISMS treats it as externally hosted.',
    options: VENDOR_DELIVERY_MODEL_OPTIONS,
  },
  dataServiceTypes: {
    label: 'Data Service Types',
    description: 'What kind of data this vendor deals in.',
    options: DATA_SERVICE_TYPE_OPTIONS,
  },
  dataFlowRoles: {
    label: 'Data Flow Roles',
    description: 'Where this vendor sits in our data flow — a vendor may hold several roles.',
    options: DATA_FLOW_ROLE_OPTIONS,
  },
} as const;

export type VendorDimensionName = keyof typeof VENDOR_DIMENSIONS;

interface VendorDimensionFieldProps {
  dimension: VendorDimensionName;
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
  value,
  onChange,
  disabled,
}: VendorDimensionFieldProps) {
  const { label, description, options } = VENDOR_DIMENSIONS[dimension];

  return (
    <ClassificationMultiSelect
      label={label}
      description={description}
      options={options}
      value={value ?? []}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
