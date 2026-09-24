// Schema + system prompt for the onboarding vendor extraction pass
// (see ../onboard-organization-helpers.ts → extractVendorsFromContext).
//
// Split out of the helpers file so the model's allowed vocabulary is unit
// testable without importing the DB / AI / Trigger.dev surface. The guarantee
// worth pinning: the `category` enum offered to the model contains ONLY the
// active categories. `Object.values(VendorCategory)` still includes the four
// retired values (`cloud`, `infrastructure`, `software_as_a_service`, `hr`) —
// Postgres cannot drop enum values mid-rollout — so building the schema from
// the Prisma enum would hand the model a menu of values nothing may write.

import {
  buildVendorClassificationGuidance,
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';
import { Impact, Likelihood } from '@db';
import type { JSONSchema7 } from 'ai';

/**
 * The vendor extraction response schema. `additionalProperties: false` plus an
 * exhaustive `required` list is what the gateway's structured-output mode wants,
 * so the three "may be empty" arrays are required too — the prompt tells the
 * model to return `[]` rather than omitting them.
 */
export const VENDOR_EXTRACTION_SCHEMA: JSONSchema7 = {
  type: 'object',
  properties: {
    vendors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          vendor_name: {
            type: 'string',
            description: 'The official company name (e.g. "Anthropic", not "Claude")',
          },
          original_name: {
            type: 'string',
            description: 'The name as it appeared in the user input (e.g. "Claude")',
          },
          vendor_website: { type: 'string' },
          vendor_description: { type: 'string' },
          category: {
            type: 'string',
            enum: [...VENDOR_CATEGORIES],
            description: 'What the vendor DOES for us. Exactly one. Never a delivery method.',
          },
          delivery_models: {
            type: 'array',
            items: { type: 'string', enum: [...VENDOR_DELIVERY_MODELS] },
            description: 'How we consume the vendor. At least one.',
          },
          data_service_types: {
            type: 'array',
            items: { type: 'string', enum: [...DATA_SERVICE_TYPES] },
            description: 'What data the vendor deals in. Return [] when it supplies no data.',
          },
          data_flow_roles: {
            type: 'array',
            items: { type: 'string', enum: [...DATA_FLOW_ROLES] },
            description:
              'Where the vendor sits in our data flow. Return [] when no data crosses the boundary.',
          },
          inherent_probability: { type: 'string', enum: Object.values(Likelihood) },
          inherent_impact: { type: 'string', enum: Object.values(Impact) },
          residual_probability: { type: 'string', enum: Object.values(Likelihood) },
          residual_impact: { type: 'string', enum: Object.values(Impact) },
        },
        required: [
          'vendor_name',
          'original_name',
          'vendor_website',
          'vendor_description',
          'category',
          'delivery_models',
          'data_service_types',
          'data_flow_roles',
          'inherent_probability',
          'inherent_impact',
          'residual_probability',
          'residual_impact',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['vendors'],
  additionalProperties: false,
};

export const VENDOR_EXTRACTION_SYSTEM_PROMPT = [
  'Extract vendor names from the following questions and answers. Return their name (grammar-correct), website, description, category, delivery models, data service types, data flow roles, inherent probability, inherent impact, residual probability, and residual impact.',
  'IMPORTANT: For vendor_name, always use the parent company name, not the product name (e.g. "Anthropic" not "Claude", "OpenAI" not "ChatGPT"). Set original_name to the name as it appeared in the user input.',
  '',
  'CLASSIFICATION — read carefully and apply consistently.',
  '',
  buildVendorClassificationGuidance(),
  '',
  'Field mapping: `category` takes exactly one value; `delivery_models` takes at least one; `data_service_types` and `data_flow_roles` take zero or more — return an empty array `[]` for those two rather than omitting the field or inventing a value. Every field is required in the response.',
  '',
  'INHERENT RISK SCORING — read carefully and apply consistently.',
  '',
  "You are estimating inherent risk from the user's onboarding answers ONLY. You do not have access to the vendor's public security posture (certifications, breach history, etc.) — a separate research step fills that in later. Score conservatively from the SIGNALS in the user's answers, not from your own knowledge of the vendor.",
  '',
  "Default both probability and impact to MIDDLE (possible × moderate → ~5/10) unless a signal in the user's answers tells you otherwise. Only deviate when the answers explicitly point to a higher or lower band.",
  '',
  'Signals that LOWER inherent_probability:',
  '- The user describes the vendor as a managed service they trust for similar infra elsewhere',
  "- The user says they've completed their own due diligence (SOC 2 review, security questionnaire) on this vendor",
  '- The vendor is mentioned only as a passive utility (e.g. analytics for marketing pages, no customer data)',
  'Signals that RAISE inherent_probability:',
  '- The user describes ongoing concerns or past incidents with the vendor',
  '- The vendor handles a category the user explicitly flags as risky',
  '- The vendor is described as a small/early-stage provider OR self-hosted by the user',
  '',
  'Signals that LOWER inherent_impact:',
  '- The vendor is used in a non-production / preview / sandbox capacity only',
  '- The user describes the vendor as handling no customer data, no PII, no auth',
  '- There is a documented fallback / alternative the user can swap to',
  'Signals that RAISE inherent_impact:',
  '- The vendor is described as production infrastructure (cloud, database, identity, payments)',
  '- The vendor processes PHI, payments, source code, auth secrets, or PII at scale',
  '- The user says they cannot easily replace the vendor',
  '',
  'When the user simply NAMES the vendor with no further context, you have NO signal — return (possible, moderate). Do not infer risk from the vendor\'s name or your prior knowledge of the company; the research step will refine the score later with actual posture data.',
  '',
  "residual_probability / residual_impact: default to the same level as inherent. Only LOWER residual when the user's answers describe their OWN compensating controls (their own MFA enforcement, network segmentation, data encryption at rest, etc.) — NOT the vendor's controls.",
].join('\n');
