/**
 * Pins the shared vendor classification vocabulary to the two things it must
 * never drift from: the Prisma enums it mirrors, and the SQL backfill that
 * rewrites live data.
 *
 * It lives in apps/api rather than packages/utils because packages/utils has no
 * test runner wired up, and this is the only workspace whose suite can see both
 * the generated Prisma enums and the shared module.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Straight from the generated client, not the `@db` barrel: the barrel
// instantiates a PrismaClient on import, and this suite only reads enum values.
import {
  DataFlowRole,
  DataServiceType,
  VendorCategory,
  VendorDeliveryModel,
} from '@prisma/client';
import {
  DATA_CENTRIC_VENDOR_CATEGORIES,
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  LEGACY_VENDOR_CATEGORIES,
  LEGACY_VENDOR_CATEGORY_MAP,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
  isActiveVendorCategory,
  isDataCentricVendorCategory,
  isExternallyHostedVendor,
  isLegacyVendorCategory,
  migrateLegacyVendorCategory,
  vendorCategoryLabel,
  vendorDeliveryModelLabel,
} from '@trycompai/utils/vendors';

const MIGRATIONS_DIR = join(
  __dirname,
  '../../../../packages/db/prisma/migrations',
);

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
}

/** Collapses whitespace so assertions survive SQL reformatting. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

describe('vendor classification vocabulary', () => {
  describe('parity with the Prisma enums', () => {
    it('accounts for every VendorCategory value exactly once', () => {
      const declared = [
        ...VENDOR_CATEGORIES,
        ...LEGACY_VENDOR_CATEGORIES,
      ].sort();
      expect(declared).toEqual(Object.values(VendorCategory).sort());
      expect(new Set(declared).size).toBe(declared.length);
    });

    it('mirrors VendorDeliveryModel, DataServiceType and DataFlowRole', () => {
      expect([...VENDOR_DELIVERY_MODELS].sort()).toEqual(
        Object.values(VendorDeliveryModel).sort(),
      );
      expect([...DATA_SERVICE_TYPES].sort()).toEqual(
        Object.values(DataServiceType).sort(),
      );
      expect([...DATA_FLOW_ROLES].sort()).toEqual(
        Object.values(DataFlowRole).sort(),
      );
    });

    it('keeps retired values out of the active set', () => {
      for (const retired of LEGACY_VENDOR_CATEGORIES) {
        expect(VENDOR_CATEGORIES).not.toContain(retired);
        expect(isActiveVendorCategory(retired)).toBe(false);
        expect(isLegacyVendorCategory(retired)).toBe(true);
      }
    });
  });

  describe('delivery method is not a functional category', () => {
    it('records SaaS as a delivery model and never as a category', () => {
      expect(VENDOR_DELIVERY_MODELS).toContain('saas');
      expect(VENDOR_CATEGORIES).not.toContain('software_as_a_service');
      expect(VENDOR_CATEGORIES).not.toContain('saas');
    });

    it('maps the retired SaaS category onto the delivery dimension', () => {
      const migrated = migrateLegacyVendorCategory('software_as_a_service');
      expect(migrated.deliveryModels).toEqual(['saas']);
      expect(migrated.category).toBe('other');
      // The function was never recorded, so it must not be invented.
      expect(migrated.needsReview).toBe(true);
    });
  });

  describe('legacy mapping', () => {
    it('covers every retired value and only targets active categories', () => {
      expect(Object.keys(LEGACY_VENDOR_CATEGORY_MAP).sort()).toEqual(
        [...LEGACY_VENDOR_CATEGORIES].sort(),
      );
      for (const mapping of Object.values(LEGACY_VENDOR_CATEGORY_MAP)) {
        expect(isActiveVendorCategory(mapping.category)).toBe(true);
        for (const model of mapping.deliveryModels) {
          expect(VENDOR_DELIVERY_MODELS).toContain(model);
        }
      }
    });

    it('applies the deterministic remaps', () => {
      expect(migrateLegacyVendorCategory('cloud').category).toBe(
        'cloud_infrastructure',
      );
      expect(migrateLegacyVendorCategory('infrastructure').category).toBe(
        'cloud_infrastructure',
      );
      expect(migrateLegacyVendorCategory('hr').category).toBe('hr_recruiting');
      // Deterministic remaps say nothing about delivery, so none is inferred.
      expect(migrateLegacyVendorCategory('cloud').deliveryModels).toEqual([]);
      expect(migrateLegacyVendorCategory('hr').needsReview).toBe(false);
    });

    it('passes active values through untouched', () => {
      for (const category of VENDOR_CATEGORIES) {
        const migrated = migrateLegacyVendorCategory(category);
        expect(migrated.category).toBe(category);
        expect(migrated.needsReview).toBe(false);
      }
    });

    it('flags an unrecognised value for review instead of guessing', () => {
      const migrated = migrateLegacyVendorCategory('not_a_real_category');
      expect(migrated.category).toBe('other');
      expect(migrated.needsReview).toBe(true);
    });
  });

  describe('SQL backfill agrees with the TypeScript mapping', () => {
    const backfill = normalize(
      readMigration('20260901000100_vendor_classification_backfill'),
    );

    it('remaps cloud and infrastructure to cloud_infrastructure', () => {
      expect(backfill).toContain(
        `SET "category" = 'cloud_infrastructure'`.replace(/\s+/g, ' '),
      );
      expect(backfill).toContain(`WHERE "category" IN ('cloud', 'infrastructure')`);
    });

    it('remaps hr to hr_recruiting', () => {
      expect(backfill).toContain(`SET "category" = 'hr_recruiting'`);
      expect(backfill).toContain(`WHERE "category" = 'hr'`);
    });

    it('turns software_as_a_service into the saas delivery model', () => {
      expect(backfill).toContain(`ARRAY['saas']::"VendorDeliveryModel"[]`);
      expect(backfill).toContain(`WHERE "category" = 'software_as_a_service'`);
    });

    it('queues the ambiguous rows for review rather than guessing', () => {
      expect(backfill).toContain('INSERT INTO "VendorClassificationReview"');
      // The review rows must be written before the UPDATE destroys the evidence.
      expect(backfill.indexOf('INSERT INTO "VendorClassificationReview"')).
        toBeLessThan(backfill.indexOf(`SET "deliveryModels"`));
    });

    it('handles every retired value', () => {
      for (const retired of LEGACY_VENDOR_CATEGORIES) {
        expect(backfill).toContain(`'${retired}'`);
      }
    });

    it('adds every active category to the enum type before use', () => {
      const expand = normalize(
        readMigration('20260901000000_vendor_classification_model'),
      );
      // finance, marketing, sales and other predate this change and are kept.
      const preserved = new Set(['finance', 'marketing', 'sales', 'other']);
      for (const category of VENDOR_CATEGORIES) {
        if (preserved.has(category)) continue;
        expect(expand).toContain(
          `ALTER TYPE "VendorCategory" ADD VALUE '${category}'`,
        );
      }
    });
  });

  describe('data-centric vendors', () => {
    it('recognises the three data categories and nothing else', () => {
      for (const category of DATA_CENTRIC_VENDOR_CATEGORIES) {
        expect(isDataCentricVendorCategory(category)).toBe(true);
        expect(VENDOR_CATEGORIES).toContain(category);
      }
      expect(isDataCentricVendorCategory('sales')).toBe(false);
      expect(isDataCentricVendorCategory(null)).toBe(false);
    });
  });

  describe('externally hosted detection', () => {
    it('reads hosting from the delivery dimension, not the category', () => {
      // A sales tool delivered as SaaS is externally hosted — the old
      // category-only check missed exactly this case.
      expect(
        isExternallyHostedVendor({
          category: 'sales',
          deliveryModels: ['saas'],
        }),
      ).toBe(true);
      // A self-hosted open-source tool is not, however it is categorised.
      expect(
        isExternallyHostedVendor({
          category: 'engineering_developer_tools',
          deliveryModels: ['open_source'],
        }),
      ).toBe(false);
    });

    it('treats cloud infrastructure as hosted regardless of delivery', () => {
      expect(
        isExternallyHostedVendor({
          category: 'cloud_infrastructure',
          deliveryModels: [],
        }),
      ).toBe(true);
    });
  });

  describe('labels', () => {
    it('labels every active and retired value', () => {
      for (const category of [
        ...VENDOR_CATEGORIES,
        ...LEGACY_VENDOR_CATEGORIES,
      ]) {
        const label = vendorCategoryLabel(category);
        expect(label).toBeTruthy();
        expect(label).not.toContain('_');
      }
    });

    it('uses real capitalisation instead of naive title-casing', () => {
      expect(vendorCategoryLabel('hr_recruiting')).toBe('HR & Recruiting');
      expect(vendorDeliveryModelLabel('saas')).toBe('SaaS');
      expect(vendorDeliveryModelLabel('api_service')).toBe('API Service');
    });

    it('marks retired values so they are not mistaken for choices', () => {
      expect(vendorCategoryLabel('software_as_a_service')).toContain('retired');
    });
  });
});
