import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  LEGACY_VENDOR_CATEGORIES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';
import type { JSONSchema7 } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  VENDOR_EXTRACTION_SCHEMA,
  VENDOR_EXTRACTION_SYSTEM_PROMPT,
} from './vendor-extraction';

/** Narrow the JSONSchema7 union down to the single vendor item's schema. */
function vendorItemSchema(): JSONSchema7 {
  const vendors = VENDOR_EXTRACTION_SCHEMA.properties?.vendors;
  if (typeof vendors !== 'object' || !('items' in vendors)) {
    throw new Error('vendors array missing from extraction schema');
  }
  const items = vendors.items;
  if (typeof items !== 'object' || Array.isArray(items)) {
    throw new Error('vendor item schema missing from extraction schema');
  }
  return items;
}

function vendorItemProperties(): Record<string, { enum?: unknown[]; items?: { enum?: unknown[] } }> {
  const { properties } = vendorItemSchema();
  if (!properties) {
    throw new Error('vendor item schema missing from extraction schema');
  }
  return properties as Record<string, { enum?: unknown[]; items?: { enum?: unknown[] } }>;
}

function requiredFields(): string[] {
  return vendorItemSchema().required ?? [];
}

describe('vendor extraction schema', () => {
  // The guarantee this whole module exists for. `Object.values(VendorCategory)`
  // still contains the four retired values because Postgres cannot drop enum
  // values mid-rollout; building the schema from it would offer the model a menu
  // of categories nothing is allowed to write — which is how a delivery method
  // ("SaaS") came to be stored as a business function in the first place.
  it('offers ONLY active category values — no retired value reaches the model', () => {
    const { category } = vendorItemProperties();

    expect(category.enum).toEqual([...VENDOR_CATEGORIES]);
    for (const retired of LEGACY_VENDOR_CATEGORIES) {
      expect(category.enum).not.toContain(retired);
    }
    expect(category.enum).not.toContain('software_as_a_service');
  });

  it('offers the full delivery model, data service and data flow vocabularies', () => {
    const properties = vendorItemProperties();

    expect(properties.delivery_models.items?.enum).toEqual([...VENDOR_DELIVERY_MODELS]);
    expect(properties.data_service_types.items?.enum).toEqual([...DATA_SERVICE_TYPES]);
    expect(properties.data_flow_roles.items?.enum).toEqual([...DATA_FLOW_ROLES]);
  });

  // The model runs with additionalProperties:false and an explicit `required`
  // list, so the "may be empty" arrays must still be required — the prompt tells
  // the model to return [] rather than omit them.
  it('requires all four classification fields', () => {
    expect(requiredFields()).toEqual(
      expect.arrayContaining([
        'category',
        'delivery_models',
        'data_service_types',
        'data_flow_roles',
      ]),
    );
  });
});

describe('vendor extraction system prompt', () => {
  it('defines every dimension rather than leaving the category unexplained', () => {
    expect(VENDOR_EXTRACTION_SYSTEM_PROMPT).toContain('"SaaS" is not a business function');
    expect(VENDOR_EXTRACTION_SYSTEM_PROMPT).toContain('data_provider sells data it already has');
    for (const category of VENDOR_CATEGORIES) {
      expect(VENDOR_EXTRACTION_SYSTEM_PROMPT).toContain(category);
    }
  });

  it('tells the model to return [] for the optional arrays', () => {
    expect(VENDOR_EXTRACTION_SYSTEM_PROMPT).toMatch(/empty array `\[\]`/);
  });

  it('keeps the inherent risk scoring guidance intact', () => {
    expect(VENDOR_EXTRACTION_SYSTEM_PROMPT).toContain('INHERENT RISK SCORING');
    expect(VENDOR_EXTRACTION_SYSTEM_PROMPT).toContain('Signals that LOWER inherent_probability:');
    expect(VENDOR_EXTRACTION_SYSTEM_PROMPT).toContain('Signals that RAISE inherent_impact:');
    expect(VENDOR_EXTRACTION_SYSTEM_PROMPT).toMatch(/return \(possible, moderate\)/);
  });
});
