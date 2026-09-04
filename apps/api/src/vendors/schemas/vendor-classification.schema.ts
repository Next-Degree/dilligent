import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';

/**
 * What each classification dimension means, in the words the public API docs use.
 *
 * One copy, because this prose reaches customers through two independent surfaces —
 * the request DTOs (`VendorClassificationFieldsDto`) and the hand-written response
 * schemas below — and a reader comparing the two should not find them disagreeing.
 */
export const VENDOR_CLASSIFICATION_DESCRIPTIONS = {
  category:
    'What the vendor does for us. Exactly one functional category — never a delivery ' +
    'method: a hosted CRM is `sales`, not "SaaS".',
  deliveryModels:
    'How we consume the vendor. Independent of what it does, and the signal that ' +
    'decides whether the workload runs outside our perimeter.',
  dataServiceTypes:
    'What data the vendor deals in, for vendors whose product is data. Empty for a ' +
    'vendor that merely stores data we type into it.',
  dataFlowRoles:
    'Where the vendor sits in our data flow. Empty when no meaningful data crosses ' +
    'the boundary; a vendor may hold several roles at once.',
} as const;

/** Example values, shared for the same reason as the descriptions. */
export const VENDOR_CLASSIFICATION_EXAMPLES = {
  category: 'cloud_infrastructure',
  deliveryModels: ['saas'],
  dataServiceTypes: ['company_data', 'enrichment'],
  dataFlowRoles: ['processor', 'source'],
} as const;

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
    description: VENDOR_CLASSIFICATION_DESCRIPTIONS.category,
    enum: [...VENDOR_CATEGORIES],
    example: VENDOR_CLASSIFICATION_EXAMPLES.category,
  },
  deliveryModels: {
    type: 'array',
    description: VENDOR_CLASSIFICATION_DESCRIPTIONS.deliveryModels,
    items: { type: 'string', enum: [...VENDOR_DELIVERY_MODELS] },
    example: [...VENDOR_CLASSIFICATION_EXAMPLES.deliveryModels],
  },
  dataServiceTypes: {
    type: 'array',
    description: VENDOR_CLASSIFICATION_DESCRIPTIONS.dataServiceTypes,
    items: { type: 'string', enum: [...DATA_SERVICE_TYPES] },
    example: [...VENDOR_CLASSIFICATION_EXAMPLES.dataServiceTypes],
  },
  dataFlowRoles: {
    type: 'array',
    description: VENDOR_CLASSIFICATION_DESCRIPTIONS.dataFlowRoles,
    items: { type: 'string', enum: [...DATA_FLOW_ROLES] },
    example: [...VENDOR_CLASSIFICATION_EXAMPLES.dataFlowRoles],
  },
};
