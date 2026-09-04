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
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
  type DataFlowRoleValue,
  type DataServiceTypeValue,
  type LegacyVendorCategory,
  type VendorCategoryValue,
  type VendorDeliveryModelValue,
} from './classification';

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
 * The values of one classification dimension, labelled and joined — or `undefined`
 * when the dimension is empty or unrecorded. Five prompt/embedding builders each
 * rendered this by hand and had already drifted; the *prefix* stays with the caller
 * because it is genuinely site-specific (a prompt may need "(customer-set)"), but
 * the "no values means no line" decision must not be re-made per site.
 */
export function vendorDimensionText(
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

export interface ClassificationOption<T extends string> {
  value: T;
  label: string;
}

function toOptions<T extends string>(
  values: readonly T[],
  label: (value: T) => string,
): ClassificationOption<T>[] {
  return values.map((value) => ({ value, label: label(value) }));
}

/**
 * Option lists for form controls. Only active categories appear — retired values
 * are readable but never selectable.
 */
export const VENDOR_CATEGORY_OPTIONS = toOptions(VENDOR_CATEGORIES, vendorCategoryLabel);
export const VENDOR_DELIVERY_MODEL_OPTIONS = toOptions(
  VENDOR_DELIVERY_MODELS,
  vendorDeliveryModelLabel,
);
export const DATA_SERVICE_TYPE_OPTIONS = toOptions(DATA_SERVICE_TYPES, dataServiceTypeLabel);
export const DATA_FLOW_ROLE_OPTIONS = toOptions(DATA_FLOW_ROLES, dataFlowRoleLabel);
