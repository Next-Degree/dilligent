import { openai } from '@ai-sdk/openai';
import { Impact, Likelihood } from '@db';
import { db } from '@db/server';
import {
  EXTERNALLY_HOSTED_DELIVERY_MODELS,
  VENDOR_CATEGORY_LABELS,
  dataFlowRoleLabel,
  dataServiceTypeLabel,
  vendorCategoryLabel,
  vendorDeliveryModelLabel,
  vendorDimensionText,
} from '@trycompai/utils/vendors';
import { logger, schemaTask } from '@trigger.dev/sdk';
import { generateObject } from 'ai';
import { z } from 'zod';

/** "A, B, and C" — the connector the impact rubric's prose already uses. */
function oxfordList(labels: readonly string[]): string {
  if (labels.length < 2) return labels.join('');
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

// The impact rubric used to spell out eleven category labels and the
// externally-hosted delivery set as prose. Re-typed vocabulary silently rots:
// relabel or add a category and the prompt goes on describing values the
// customer no longer sees. Interpolated from the shared vocabulary instead.
const HIGH_IMPACT_CATEGORIES = oxfordList([
  VENDOR_CATEGORY_LABELS.cloud_infrastructure,
  VENDOR_CATEGORY_LABELS.identity_access_management,
  VENDOR_CATEGORY_LABELS.engineering_developer_tools,
  VENDOR_CATEGORY_LABELS.finance,
]);

const BUSINESS_RECORD_CATEGORIES = oxfordList([
  VENDOR_CATEGORY_LABELS.sales,
  VENDOR_CATEGORY_LABELS.marketing,
  VENDOR_CATEGORY_LABELS.collaboration_productivity,
  VENDOR_CATEGORY_LABELS.analytics_observability,
  VENDOR_CATEGORY_LABELS.hr_recruiting,
  VENDOR_CATEGORY_LABELS.legal,
  VENDOR_CATEGORY_LABELS.customer_support,
]);

// Mirrors `isExternallyHostedVendor`'s delivery-model half exactly, so the rubric
// cannot drift from the predicate the rest of the product scopes on.
const EXTERNALLY_HOSTED_DELIVERY = EXTERNALLY_HOSTED_DELIVERY_MODELS.map(
  vendorDeliveryModelLabel,
).join(', ');

const ScoreSchema = z.object({
  inherent_probability: z.nativeEnum(Likelihood),
  inherent_impact: z.nativeEnum(Impact),
  residual_probability: z.nativeEnum(Likelihood),
  residual_impact: z.nativeEnum(Impact),
  rationale: z.string(),
});

/**
 * Refine a vendor's inherent + residual risk scores using the data the
 * `research-vendor` task gathered into GlobalVendors. The onboarding
 * extraction pass scores conservatively from the user's Q&A signals only
 * (no posture data), so it lands a lot of well-attested vendors at the
 * generic middle. Once research has collected certifications, type, and
 * description, we can ground the score in actual evidence and refine.
 *
 * Idempotent: safe to re-run for the same (vendorId, organizationId)
 * — overwrites the four risk fields with the latest LLM verdict.
 */
export const scoreVendorRisk = schemaTask({
  id: 'score-vendor-risk',
  schema: z.object({
    vendorId: z.string(),
    organizationId: z.string(),
  }),
  maxDuration: 60,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    const { vendorId, organizationId } = payload;

    const vendor = await db.vendor.findFirst({
      where: { id: vendorId, organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        deliveryModels: true,
        dataServiceTypes: true,
        dataFlowRoles: true,
        website: true,
      },
    });
    if (!vendor) {
      logger.warn('[score-vendor-risk] vendor not found, skipping', payload);
      return { skipped: 'vendor-not-found' as const };
    }
    if (!vendor.website) {
      logger.info('[score-vendor-risk] vendor has no website, skipping', payload);
      return { skipped: 'no-website' as const };
    }

    const globalVendor = await db.globalVendors.findFirst({
      where: { website: vendor.website },
      select: {
        company_description: true,
        security_certifications: true,
        subprocessors: true,
        type_of_company: true,
        security_page_url: true,
        trust_page_url: true,
      },
    });

    // Without GlobalVendors data we have nothing more than the extraction
    // pass already had — re-running the LLM would just burn tokens to
    // produce the same answer. Bail.
    if (!globalVendor) {
      logger.info(
        '[score-vendor-risk] no GlobalVendors row yet — research probably still in flight; skipping',
        payload,
      );
      return { skipped: 'no-research-data' as const };
    }

    const certifications = globalVendor.security_certifications ?? [];
    const subprocessors = globalVendor.subprocessors ?? [];
    const description = globalVendor.company_description ?? vendor.description ?? '';
    const typeOfCompany = globalVendor.type_of_company ?? '';
    const hasTrustOrSecurityPage = Boolean(
      globalVendor.security_page_url ?? globalVendor.trust_page_url,
    );

    const deliveryModels = vendorDimensionText(vendor.deliveryModels, vendorDeliveryModelLabel);
    const dataServiceTypes = vendorDimensionText(vendor.dataServiceTypes, dataServiceTypeLabel);
    const dataFlowRoles = vendorDimensionText(vendor.dataFlowRoles, dataFlowRoleLabel);

    const promptBlock = [
      `Vendor: ${vendor.name}`,
      `Function / category (customer-set): ${vendorCategoryLabel(vendor.category)}`,
      deliveryModels ? `Delivery model (customer-set): ${deliveryModels}` : null,
      dataServiceTypes ? `Data services (customer-set): ${dataServiceTypes}` : null,
      dataFlowRoles ? `Data flow role (customer-set): ${dataFlowRoles}` : null,
      typeOfCompany ? `Type (researched): ${typeOfCompany}` : null,
      description ? `Description: ${description}` : null,
      certifications.length > 0
        ? `Certifications / attestations (researched): ${certifications.join(', ')}`
        : 'Certifications / attestations: none reported',
      subprocessors.length > 0
        ? `Subprocessors (researched): ${subprocessors.join(', ')}`
        : null,
      hasTrustOrSecurityPage
        ? 'Vendor publishes a trust portal or security overview page (transparency signal).'
        : 'No public trust portal / security overview page found.',
    ]
      .filter(Boolean)
      .join('\n');

    const { object } = await generateObject({
      model: openai('gpt-4.1-mini'),
      schema: ScoreSchema,
      system: [
        'You are scoring inherent vendor risk for a customer that has just listed this vendor as part of their compliance program. Your job is to assign Likelihood and Impact buckets based on the researched data below.',
        '',
        'inherent_probability — probability of a meaningful security or availability incident at the vendor over a typical 12-month window:',
        '- very_unlikely: hyperscaler-tier vendor with multiple top-tier attestations (e.g. SOC 2 Type II + ISO 27001, OR FedRAMP, OR multiple of those) AND clear public transparency.',
        '- unlikely: established vendor with at least one strong third-party attestation (SOC 2 Type II, ISO 27001, ISO 42001, HIPAA, PCI DSS Level 1, or equivalent) AND a public security/trust page.',
        '- possible: vendor without independent attestation, OR with minor incidents in the last few years, OR limited public posture data. This is the DEFAULT.',
        '- likely: vendor with public knowledge of significant security incidents in the last 24 months, OR explicitly no transparency despite handling sensitive data.',
        '- very_likely: vendor with chronic / repeated security issues, or essentially unknown posture combined with sensitive-data exposure.',
        '',
        'inherent_impact — business impact if the vendor is compromised, driven by WHAT the vendor does and WHAT DATA it touches, not by how it is delivered:',
        '- insignificant: no PII / no business data / purely cosmetic or public utility.',
        '- minor: anonymous metadata only, non-business utilities.',
        '- moderate: the vendor holds PII or internal business data, but NOT payments / health / source code / authentication / production infrastructure. This is the DEFAULT for a vendor that stores ordinary business records.',
        '- major: vendor handles authentication, source code, payments, PHI, or production infrastructure that the customer depends on.',
        '- severe: vendor IS the customer\'s production runtime / cloud / single source of truth — compromise means the customer is offline or fundamentally exposed.',
        '',
        'Scoring rules:',
        '1. Read the certification list. ANY of {SOC 2 Type II, ISO 27001, ISO 42001, HIPAA, PCI DSS, FedRAMP, C5, CSA STAR Level 2+} counts as a strong attestation. Multiple of those, especially combined with FedRAMP / hyperscaler-tier scale, drop probability to very_unlikely. A single strong attestation drops probability to unlikely.',
        '2. If the certification list is empty, default probability is possible (NOT very_likely). "We don\'t know" is not "definitely bad".',
        `3. Set impact from the FUNCTIONAL category first — what the vendor does for the customer. ${HIGH_IMPACT_CATEGORIES} vendors sit on production runtime, authentication, source code, or payments → major, rising to severe when the vendor is the single source of truth for one of them. ${BUSINESS_RECORD_CATEGORIES} vendors hold business records and PII → moderate. A vendor with no access to business data or PII → minor.`,
        '4. Then adjust with the data dimensions. Data services covering People Data, Contact Data, Financial Data, or Enrichment mean identifiable or regulated records are in play → raise impact one band. A vendor whose data flow role includes `destination` or `processor` HOLDS or ACTS ON the customer\'s data and is higher impact than a pure `source`, which only sends data in. An empty data flow role means nothing meaningful crosses the boundary — do not raise impact for it.',
        `5. Delivery model changes EXPOSURE, not function. Externally-hosted delivery (${EXTERNALLY_HOSTED_DELIVERY}) puts the data outside the customer's perimeter, so it argues for the higher end of the band the function already set; self-hosted or open-source delivery keeps it inside. Never let a delivery model set the band on its own — "it is SaaS" says nothing about what the vendor does.`,
        '6. Residual: default to inherent. Only LOWER residual when the customer has applied their OWN compensating controls (which we don\'t have visibility into here, so usually leave equal).',
        '',
        'Be specific in the rationale — name a certification, name an attribute. Don\'t recite the rubric.',
      ].join('\n'),
      prompt: promptBlock,
    });

    await db.vendor.update({
      where: { id: vendorId },
      data: {
        inherentProbability: object.inherent_probability,
        inherentImpact: object.inherent_impact,
        residualProbability: object.residual_probability,
        residualImpact: object.residual_impact,
      },
    });

    logger.info('[score-vendor-risk] scored vendor', {
      vendorId,
      organizationId,
      vendorName: vendor.name,
      inherent: `${object.inherent_probability} × ${object.inherent_impact}`,
      residual: `${object.residual_probability} × ${object.residual_impact}`,
      rationale: object.rationale,
      certifications,
    });

    return {
      inherentProbability: object.inherent_probability,
      inherentImpact: object.inherent_impact,
      residualProbability: object.residual_probability,
      residualImpact: object.residual_impact,
      rationale: object.rationale,
    };
  },
});
