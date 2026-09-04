/**
 * The user-facing copy for the three classification dimensions.
 *
 * The create sheet and the vendor edit form lay these fields out differently —
 * create hides the data pair until the category is data-centric, edit tucks it
 * behind a disclosure — but they are asking the same questions, so the labels and
 * descriptions live here once instead of drifting apart in two components.
 */
export const VENDOR_CLASSIFICATION_COPY = {
  deliveryModels: {
    label: 'Delivery Models',
    description:
      'How we consume this vendor. Drives whether the ISMS treats it as externally hosted.',
  },
  dataServiceTypes: {
    label: 'Data Service Types',
    description: 'What kind of data this vendor deals in.',
  },
  dataFlowRoles: {
    label: 'Data Flow Roles',
    description: 'Where this vendor sits in our data flow — a vendor may hold several roles.',
  },
} as const;
