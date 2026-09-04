/**
 * Vendor classification vocabulary — the single source of truth shared by the API,
 * the app, and the AI classification prompts.
 *
 * A vendor is described along four independent dimensions. They were previously
 * collapsed into one `category` enum, which mixed *what a vendor does* with *how it
 * is delivered* ("software_as_a_service" is not a business function), making the
 * category unusable for risk analysis.
 *
 *   1. category         — what the vendor does for us. Exactly one.
 *   2. deliveryModels   — how we consume it. Zero or more.
 *   3. dataServiceTypes — what data it deals in, for data vendors. Zero or more.
 *   4. dataFlowRoles    — where it sits in our data flow. Zero or more.
 *
 * These arrays mirror the Prisma enums in `packages/db/prisma/schema/vendor.prisma`.
 * They are declared as plain literals rather than imported from `@prisma/client` so
 * that browser bundles and prompt builders can use them without pulling in the
 * client. `apps/api/src/vendors/vendor-classification-vocabulary.spec.ts` fails if
 * the two ever drift.
 */

/** What the vendor does for us. Function only — never delivery method. */
export const VENDOR_CATEGORIES = [
  'cloud_infrastructure',
  'engineering_developer_tools',
  'security_compliance',
  'identity_access_management',
  'artificial_intelligence',
  'data_provider',
  'data_enrichment',
  'data_collection',
  'automation_integration',
  'analytics_observability',
  'collaboration_productivity',
  'design_creative',
  'finance',
  'marketing',
  'sales',
  'hr_recruiting',
  'legal',
  'customer_support',
  'other',
] as const;

export type VendorCategoryValue = (typeof VENDOR_CATEGORIES)[number];

/** How we consume the vendor. Orthogonal to what it does. */
export const VENDOR_DELIVERY_MODELS = [
  'saas',
  'cloud_service',
  'api_service',
  'managed_service',
  'desktop_application',
  'mobile_application',
  'browser_extension',
  'open_source',
  'internal_application',
  'other',
] as const;

export type VendorDeliveryModelValue = (typeof VENDOR_DELIVERY_MODELS)[number];

/** What kind of data a data vendor deals in. Empty for vendors that supply no data. */
export const DATA_SERVICE_TYPES = [
  'people_data',
  'company_data',
  'contact_data',
  'web_data',
  'financial_data',
  'intent_data',
  'search',
  'scraping',
  'enrichment',
  'verification',
  'matching',
  'other',
] as const;

export type DataServiceTypeValue = (typeof DATA_SERVICE_TYPES)[number];

/** Where the vendor sits in our data flow. Empty when no data crosses the boundary. */
export const DATA_FLOW_ROLES = ['source', 'processor', 'destination'] as const;

export type DataFlowRoleValue = (typeof DATA_FLOW_ROLES)[number];

/**
 * Categories whose whole purpose is supplying or handling data. The UI surfaces
 * `dataServiceTypes` and `dataFlowRoles` prominently for these, and keeps them
 * behind a disclosure for everything else.
 */
export const DATA_CENTRIC_VENDOR_CATEGORIES = [
  'data_provider',
  'data_enrichment',
  'data_collection',
] as const satisfies readonly VendorCategoryValue[];

/**
 * A membership test over one of the vocabularies above. Written once so the
 * `value as T` cast `Array.includes` forces on a wider input lives in exactly one
 * place rather than being re-made by every guard in this file.
 */
function isMemberOf<T extends string>(
  values: readonly T[],
): (value: string | null | undefined) => value is T {
  return (value): value is T => values.includes(value as T);
}

export const isDataCentricVendorCategory = isMemberOf(DATA_CENTRIC_VENDOR_CATEGORIES);

/**
 * Delivery models that place the workload outside our own perimeter. This is the
 * signal ISMS scoping actually wants — previously approximated by the
 * cloud/infrastructure/software_as_a_service categories, which both over-counted
 * (a self-hosted open-source tool categorised `infrastructure`) and under-counted
 * (a SaaS CRM categorised `sales`).
 */
export const EXTERNALLY_HOSTED_DELIVERY_MODELS = [
  'saas',
  'cloud_service',
  'api_service',
  'managed_service',
] as const satisfies readonly VendorDeliveryModelValue[];

const isExternallyHostedDeliveryModel = isMemberOf(EXTERNALLY_HOSTED_DELIVERY_MODELS);

/**
 * Whether a vendor runs outside our perimeter, so the ISMS must treat it as a
 * third-party dependency. Cloud infrastructure counts regardless of how it is
 * recorded, because that is what the category means.
 */
export function isExternallyHostedVendor(vendor: {
  category: string;
  deliveryModels: readonly string[];
}): boolean {
  if (vendor.category === 'cloud_infrastructure') return true;
  return vendor.deliveryModels.some(isExternallyHostedDeliveryModel);
}

/**
 * Category values that predate the functional-only model. They remain in the
 * Postgres enum so that a rolling deploy — old app instances still writing them —
 * cannot fail, and so the backfill is reversible. Nothing may *write* them: the
 * API rejects them and the UI never offers them. A follow-up contract migration
 * drops them from the type once every instance is on the new code.
 */
export const LEGACY_VENDOR_CATEGORIES = [
  'cloud',
  'infrastructure',
  'software_as_a_service',
  'hr',
] as const;

export type LegacyVendorCategory = (typeof LEGACY_VENDOR_CATEGORIES)[number];

export const isLegacyVendorCategory = isMemberOf(LEGACY_VENDOR_CATEGORIES);

/** A category the application is allowed to write today. */
export const isActiveVendorCategory = isMemberOf(VENDOR_CATEGORIES);

export interface LegacyCategoryMigration {
  /** The functional category the legacy value becomes. */
  category: VendorCategoryValue;
  /** Delivery models the legacy value was really describing. */
  deliveryModels: readonly VendorDeliveryModelValue[];
  /**
   * True when the legacy value carried no functional meaning, so the mapping is a
   * placeholder rather than an answer. These rows land in
   * `VendorClassificationReview` for a human to categorise.
   */
  needsReview: boolean;
}

/**
 * How each retired value is rewritten. Mirrored exactly by the backfill migration
 * `20260904000100_vendor_classification_backfill`; the vocabulary spec pins the
 * two together so the SQL and the TypeScript cannot drift.
 *
 * `software_as_a_service` is the only lossy case: it described delivery, so the
 * function is genuinely unknown. We record the delivery model we *do* know and
 * refuse to invent a category for it.
 */
export const LEGACY_VENDOR_CATEGORY_MAP: Record<LegacyVendorCategory, LegacyCategoryMigration> = {
  cloud: {
    category: 'cloud_infrastructure',
    deliveryModels: [],
    needsReview: false,
  },
  infrastructure: {
    category: 'cloud_infrastructure',
    deliveryModels: [],
    needsReview: false,
  },
  hr: { category: 'hr_recruiting', deliveryModels: [], needsReview: false },
  software_as_a_service: {
    category: 'other',
    deliveryModels: ['saas'],
    needsReview: true,
  },
};

/**
 * Normalises any category value read from the database. Active values pass
 * through; legacy values are mapped. Used on read paths so a row that has not yet
 * been backfilled still renders correctly.
 */
export function migrateLegacyVendorCategory(value: string): LegacyCategoryMigration {
  if (isLegacyVendorCategory(value)) return LEGACY_VENDOR_CATEGORY_MAP[value];
  if (isActiveVendorCategory(value)) {
    return { category: value, deliveryModels: [], needsReview: false };
  }
  return { category: 'other', deliveryModels: [], needsReview: true };
}
