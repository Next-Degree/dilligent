/**
 * Human-readable labels for the vendor classification enums.
 *
 * These replace seven separate ad-hoc formatters that had drifted apart — a
 * snake_case title-caser in the create form and the detail form, a different
 * one in the chart, and three hand-written label maps in the tables. The two
 * kinds disagreed: the same vendor read "Software As A Service" on its detail
 * page and "SaaS" in the table.
 *
 * Every label is explicit rather than derived, because derivation cannot know
 * that `hr_recruiting` is "HR & Recruiting" and not "Hr Recruiting".
 */

import {
  DATA_FLOW_ROLES,
  EXTERNALLY_HOSTED_DELIVERY_MODELS,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
  migrateLegacyVendorCategory,
  type DataFlowRoleValue,
  type DataServiceTypeValue,
  type LegacyVendorCategory,
  type VendorCategoryValue,
  type VendorDeliveryModelValue,
} from './classification';
import {
  DATA_FLOW_ROLE_DESCRIPTIONS,
  DATA_SERVICE_TYPE_DESCRIPTIONS,
  VENDOR_CATEGORY_DESCRIPTIONS,
  VENDOR_DELIVERY_MODEL_DESCRIPTIONS,
} from './descriptions';

export const VENDOR_CATEGORY_LABELS: Record<VendorCategoryValue, string> = {
  cloud_infrastructure: 'Cloud & Infrastructure',
  engineering_developer_tools: 'Engineering & Developer Tools',
  security_compliance: 'Security & Compliance',
  identity_access_management: 'Identity & Access Management',
  artificial_intelligence: 'Artificial Intelligence',
  data_provider: 'Data Provider',
  data_enrichment: 'Data Enrichment',
  data_collection: 'Data Collection',
  automation_integration: 'Automation & Integration',
  analytics_observability: 'Analytics & Observability',
  collaboration_productivity: 'Collaboration & Productivity',
  design_creative: 'Design & Creative',
  finance: 'Finance',
  marketing: 'Marketing',
  sales: 'Sales',
  hr_recruiting: 'HR & Recruiting',
  legal: 'Legal',
  customer_support: 'Customer Support',
  other: 'Other',
};

/**
 * Retired values still readable from un-backfilled rows. Marked so nobody mistakes
 * one for a current choice when it surfaces in an export or an audit log.
 */
export const LEGACY_VENDOR_CATEGORY_LABELS: Record<LegacyVendorCategory, string> = {
  cloud: 'Cloud (retired)',
  infrastructure: 'Infrastructure (retired)',
  software_as_a_service: 'SaaS (retired)',
  hr: 'HR (retired)',
};

export const VENDOR_DELIVERY_MODEL_LABELS: Record<VendorDeliveryModelValue, string> = {
  saas: 'SaaS',
  cloud_service: 'Cloud Service',
  api_service: 'API Service',
  managed_service: 'Managed Service',
  desktop_application: 'Desktop Application',
  mobile_application: 'Mobile Application',
  browser_extension: 'Browser Extension',
  open_source: 'Open Source',
  internal_application: 'Internal Application',
  other: 'Other',
};

export const DATA_SERVICE_TYPE_LABELS: Record<DataServiceTypeValue, string> = {
  people_data: 'People Data',
  company_data: 'Company Data',
  contact_data: 'Contact Data',
  web_data: 'Web Data',
  financial_data: 'Financial Data',
  intent_data: 'Intent Data',
  search: 'Search',
  scraping: 'Scraping',
  enrichment: 'Enrichment',
  verification: 'Verification',
  matching: 'Matching',
  other: 'Other',
};

export const DATA_FLOW_ROLE_LABELS: Record<DataFlowRoleValue, string> = {
  source: 'Source',
  processor: 'Processor',
  destination: 'Destination',
};

/**
 * Last-resort formatter for a value no label map covers — a row written by a
 * newer deploy, say. Never the primary path; the maps above are exhaustive.
 */
function humanize(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Label for any category, current or retired. */
export function vendorCategoryLabel(value: string): string {
  return (
    VENDOR_CATEGORY_LABELS[value as VendorCategoryValue] ??
    LEGACY_VENDOR_CATEGORY_LABELS[value as LegacyVendorCategory] ??
    humanize(value)
  );
}

export function vendorDeliveryModelLabel(value: string): string {
  return VENDOR_DELIVERY_MODEL_LABELS[value as VendorDeliveryModelValue] ?? humanize(value);
}

export function dataServiceTypeLabel(value: string): string {
  return DATA_SERVICE_TYPE_LABELS[value as DataServiceTypeValue] ?? humanize(value);
}

export function dataFlowRoleLabel(value: string): string {
  return DATA_FLOW_ROLE_LABELS[value as DataFlowRoleValue] ?? humanize(value);
}

/**
 * A category label for anywhere the value must read as the vendor's FUNCTION:
 * AI prompts, embedding text, exported documents.
 *
 * `vendorCategoryLabel` renders a retired value as "SaaS (retired)", which is the
 * right thing on screen — it tells a human the row still needs reclassifying. Fed
 * to a model or printed in an ISMS document it is actively wrong: it re-asserts the
 * delivery-as-function conflation this vocabulary exists to remove, and "(retired)"
 * means nothing to a reader who never saw the old enum. Rows can still hold retired
 * values until the backfill has run everywhere, so these paths migrate first.
 */
export function vendorFunctionLabel(category: string): string {
  return vendorCategoryLabel(migrateLegacyVendorCategory(category).category);
}

/** One dimension's values, labelled and joined — `undefined` when it holds none. */
function vendorDimensionText(
  values: readonly string[] | null | undefined,
  label: (value: string) => string,
): string | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map(label).join(', ');
}

/**
 * All three list dimensions of a vendor, rendered at once. Callers own their
 * prefixes — the prompts legitimately word them differently — but not the pairing
 * of a field with its labeller, which was re-stated at five call sites and is the
 * kind of copy-paste that compiles while describing the wrong dimension.
 */
export function describeVendorDimensions(vendor: {
  deliveryModels?: readonly string[] | null;
  dataServiceTypes?: readonly string[] | null;
  dataFlowRoles?: readonly string[] | null;
}): {
  deliveryModels?: string;
  dataServiceTypes?: string;
  dataFlowRoles?: string;
} {
  return {
    deliveryModels: vendorDimensionText(vendor.deliveryModels, vendorDeliveryModelLabel),
    dataServiceTypes: vendorDimensionText(vendor.dataServiceTypes, dataServiceTypeLabel),
    dataFlowRoles: vendorDimensionText(vendor.dataFlowRoles, dataFlowRoleLabel),
  };
}

/**
 * The externally-hosted delivery models as prose, for prompts that state the
 * hosting rule in words. Shared so the risk-scoring rubric and the auditor prompt
 * cannot describe `isExternallyHostedVendor`'s delivery half differently — they
 * each built this string themselves, and an earlier hand-typed version had already
 * lost `api_service`.
 */
export const EXTERNALLY_HOSTED_DELIVERY_MODEL_TEXT = EXTERNALLY_HOSTED_DELIVERY_MODELS.map(
  vendorDeliveryModelLabel,
).join(', ');

/**
 * `DataServiceType` answers two questions at once: what the data IS
 * (`people_data`, `web_data`) and what the vendor DOES with it (`enrichment`,
 * `matching`). Both belong on the one field — most data vendors are both, and
 * splitting them into two enums would force a false choice — but a flat list of
 * twelve checkboxes hides the distinction, so the form groups them under
 * headings. `other` sits under neither: it spans both questions.
 */
export const DATA_SERVICE_TYPE_SECTIONS = {
  people_data: 'Kinds of data',
  company_data: 'Kinds of data',
  contact_data: 'Kinds of data',
  web_data: 'Kinds of data',
  financial_data: 'Kinds of data',
  intent_data: 'Kinds of data',
  search: 'What the vendor does with it',
  scraping: 'What the vendor does with it',
  enrichment: 'What the vendor does with it',
  verification: 'What the vendor does with it',
  matching: 'What the vendor does with it',
} as const satisfies Partial<Record<DataServiceTypeValue, string>>;

export interface ClassificationOption<T extends string> {
  value: T;
  label: string;
  /** The same one-liner the AI prompts are given, so the form and the model agree. */
  description: string;
  /**
   * Optional heading this option sits under. Vocabularies that ask one question
   * leave it unset and render as a flat list.
   */
  section?: string;
}

function toOptions<T extends string>(
  values: readonly T[],
  label: (value: T) => string,
  descriptions: Record<T, string>,
  sections: Partial<Record<T, string>> = {},
): ClassificationOption<T>[] {
  return values.map((value) => ({
    value,
    label: label(value),
    description: descriptions[value],
    section: sections[value],
  }));
}

/**
 * Option lists for form controls. Only active categories appear — retired values
 * are readable but never selectable.
 */
export const VENDOR_CATEGORY_OPTIONS = toOptions(
  VENDOR_CATEGORIES,
  vendorCategoryLabel,
  VENDOR_CATEGORY_DESCRIPTIONS,
);
export const VENDOR_DELIVERY_MODEL_OPTIONS = toOptions(
  VENDOR_DELIVERY_MODELS,
  vendorDeliveryModelLabel,
  VENDOR_DELIVERY_MODEL_DESCRIPTIONS,
);
export const DATA_SERVICE_TYPE_OPTIONS = toOptions(
  DATA_SERVICE_TYPES,
  dataServiceTypeLabel,
  DATA_SERVICE_TYPE_DESCRIPTIONS,
  DATA_SERVICE_TYPE_SECTIONS,
);
export const DATA_FLOW_ROLE_OPTIONS = toOptions(
  DATA_FLOW_ROLES,
  dataFlowRoleLabel,
  DATA_FLOW_ROLE_DESCRIPTIONS,
);
