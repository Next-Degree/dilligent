import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';

/**
 * The four classification properties as they appear in every hand-written vendor
 * response schema. Shared rather than repeated because the enums used to be inlined
 * in four files and drifted the moment the vocabulary changed — three of them still
 * advertised `software_as_a_service` as a category long after it stopped being one.
 *
 * Spread into the `properties` object of any schema that returns a vendor.
 */
export const VENDOR_CLASSIFICATION_SCHEMA_PROPERTIES = {
  category: {
    type: 'string',
    description:
      'What the vendor does for us. Exactly one functional category — never a delivery method.',
    enum: [...VENDOR_CATEGORIES],
    example: 'cloud_infrastructure',
  },
  deliveryModels: {
    type: 'array',
    description:
      'How we consume the vendor. Decides whether the workload runs outside our perimeter.',
    items: { type: 'string', enum: [...VENDOR_DELIVERY_MODELS] },
    example: ['saas'],
  },
  dataServiceTypes: {
    type: 'array',
    description:
      'What data the vendor deals in. Empty unless data is the vendor’s product.',
    items: { type: 'string', enum: [...DATA_SERVICE_TYPES] },
    example: ['company_data', 'enrichment'],
  },
  dataFlowRoles: {
    type: 'array',
    description: 'Where the vendor sits in our data flow. Empty when no data crosses.',
    items: { type: 'string', enum: [...DATA_FLOW_ROLES] },
    example: ['processor', 'source'],
  },
};
