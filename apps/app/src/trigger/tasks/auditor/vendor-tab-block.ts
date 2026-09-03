// Renders the org's Vendors tab into the plain-text block fed to the auditor
// content prompts (see ./generate-auditor-content-prompts.ts, which re-exports
// everything here so callers keep a single import site). Split out to keep that
// module under the 300-line limit once vendors grew from one category enum to
// four independent classification dimensions.

import {
  dataFlowRoleLabel,
  dataServiceTypeLabel,
  vendorCategoryLabel,
  vendorDeliveryModelLabel,
  vendorDimensionText,
} from '@trycompai/utils/vendors';

// A single vendor as recorded in the org's Vendors tab. The four classification
// dimensions are independent: `category` is what the vendor does, `deliveryModels`
// is how it is consumed, and the two data fields describe what it handles and
// which way that data moves. They are rendered with human labels so the model
// never sees a raw enum value like `software_as_a_service`.
export type VendorTabEntry = {
  name: string;
  description: string | null;
  category: string | null;
  deliveryModels?: readonly string[] | null;
  dataServiceTypes?: readonly string[] | null;
  dataFlowRoles?: readonly string[] | null;
  website: string | null;
};

// Placeholder descriptions written by the onboarding vendor fallback loop
// (onboard-organization-helpers.ts) when a vendor is named during onboarding
// but no real description was extracted. They carry no business function, so
// buildVendorsBlock drops them before the critical-vendors prompt — left in,
// the model echoes them verbatim as the vendor's "function" (CS-747, e.g.
// "Claude AI - SaaS - (Onboarding-selected vendor)").
export const SELECTED_ONBOARDING_VENDOR_DESCRIPTION = 'Vendor selected during onboarding';
export const CUSTOM_ONBOARDING_VENDOR_DESCRIPTION = 'Custom vendor added during onboarding';
export const ONBOARDING_VENDOR_PLACEHOLDER_DESCRIPTIONS: readonly string[] = [
  SELECTED_ONBOARDING_VENDOR_DESCRIPTION,
  CUSTOM_ONBOARDING_VENDOR_DESCRIPTION,
];

/**
 * Formats the org's Vendors tab into a plain-text block for the prompt. Lists
 * EVERY vendor so the model can reproduce the full list — CS-589: the critical
 * vendors list was coming back too small because the structured Vendors tab was
 * never passed (only the website scrape + Q&A were).
 *
 * Each line reads `- Name — Category — Delivery — Data: … — Flow: … — Description
 * (website)`, with every dimension carrying its human label. Empty dimensions are
 * dropped entirely rather than rendered as "none", so a vendor with no recorded
 * delivery model or data footprint produces no dangling separators.
 */
export function buildVendorsBlock(vendors: VendorTabEntry[]): string {
  if (vendors.length === 0) {
    return 'No vendors are recorded in the Vendors tab.';
  }

  return vendors.map(renderVendorLine).join('\n');
}

function renderVendorLine(vendor: VendorTabEntry): string {
  const description = vendor.description?.trim();
  // Drop the onboarding fallback placeholders (CS-747): they are not a real
  // function, and the model otherwise echoes them verbatim as the vendor's
  // function. Stripped, the model describes the vendor from its own knowledge,
  // grounded by the recorded category.
  const meaningfulDescription =
    description && !ONBOARDING_VENDOR_PLACEHOLDER_DESCRIPTIONS.includes(description)
      ? description
      : undefined;

  const dataServiceTypes = vendorDimensionText(vendor.dataServiceTypes, dataServiceTypeLabel);
  const dataFlowRoles = vendorDimensionText(vendor.dataFlowRoles, dataFlowRoleLabel);

  const details = [
    vendor.category ? vendorCategoryLabel(vendor.category) : undefined,
    vendorDimensionText(vendor.deliveryModels, vendorDeliveryModelLabel),
    dataServiceTypes ? `Data: ${dataServiceTypes}` : undefined,
    dataFlowRoles ? `Flow: ${dataFlowRoles}` : undefined,
    meaningfulDescription,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  const detailText = details.length > 0 ? ` — ${details.join(' — ')}` : '';
  const websiteSuffix = vendor.website?.trim() ? ` (${vendor.website.trim()})` : '';
  return `- ${vendor.name.trim()}${detailText}${websiteSuffix}`;
}
