import {
  migrateLegacyVendorCategory,
  type DataFlowRoleValue,
  type DataServiceTypeValue,
  type VendorCategoryValue,
  type VendorDeliveryModelValue,
} from '@trycompai/utils/vendors';

interface ClassifiedVendor {
  category: string;
  deliveryModels?: readonly VendorDeliveryModelValue[] | null;
  dataServiceTypes?: readonly DataServiceTypeValue[] | null;
  dataFlowRoles?: readonly DataFlowRoleValue[] | null;
}

/**
 * The four classification fields of `updateVendorSchema`, seeded from a vendor row.
 *
 * Both edit forms submit the whole schema, so both must supply these — including
 * the title form, which does not show them. Shared because the normalisation is not
 * inert: a row the backfill has not reached still holds a retired category the
 * schema rejects, so it is mapped to its functional equivalent rather than blocking
 * an unrelated edit. A second copy of that rule would go stale the moment the
 * contract migration retires `migrateLegacyVendorCategory`.
 */
export function vendorClassificationDefaults(vendor: ClassifiedVendor): {
  category: VendorCategoryValue;
  deliveryModels: VendorDeliveryModelValue[];
  dataServiceTypes: DataServiceTypeValue[];
  dataFlowRoles: DataFlowRoleValue[];
} {
  return {
    category: migrateLegacyVendorCategory(vendor.category).category,
    // Rows written before the classification split have no arrays at all; `?? []`
    // keeps the checkbox groups controlled either way.
    deliveryModels: [...(vendor.deliveryModels ?? [])],
    dataServiceTypes: [...(vendor.dataServiceTypes ?? [])],
    dataFlowRoles: [...(vendor.dataFlowRoles ?? [])],
  };
}
