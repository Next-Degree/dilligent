-- Moves every vendor off the retired category values added in
-- 20260904000000_vendor_classification_model. Separate migration because a value
-- added by ALTER TYPE ... ADD VALUE cannot be referenced in the transaction that
-- added it.
--
-- Mapping:
--   cloud, infrastructure -> cloud_infrastructure   (deterministic)
--   hr                    -> hr_recruiting          (deterministic)
--   software_as_a_service -> deliveryModels += saas, category -> other
--
-- The last one is the only lossy case: `software_as_a_service` described delivery,
-- so the vendor's actual function was never recorded and cannot be derived. We
-- keep the delivery model we do know and refuse to guess a category — each such
-- row is queued in "VendorClassificationReview" for a human instead. Query the
-- unresolved queue with:
--   SELECT * FROM "VendorClassificationReview" WHERE "resolvedAt" IS NULL;
--
-- Every statement is idempotent and scoped by the value it rewrites, so a re-run
-- is a no-op.

-- Record the ambiguous rows BEFORE rewriting them, while the evidence still
-- exists. previousCategory is TEXT so this record survives the later contract
-- migration that drops the value from the enum.
INSERT INTO "VendorClassificationReview" (
  "organizationId",
  "vendorId",
  "previousCategory",
  "assignedCategory",
  "reason",
  "updatedAt"
)
SELECT
  v."organizationId",
  v."id",
  v."category"::text,
  'other',
  'Was categorised software_as_a_service, which described delivery rather than function. Delivery model recorded as saas; functional category needs a human decision.',
  CURRENT_TIMESTAMP
FROM "Vendor" v
WHERE v."category" = 'software_as_a_service'
  AND NOT EXISTS (
    SELECT 1 FROM "VendorClassificationReview" r
    WHERE r."vendorId" = v."id"
      AND r."previousCategory" = 'software_as_a_service'
  );

-- software_as_a_service: keep the delivery signal, drop the false category.
-- The array union preserves anything already set rather than overwriting it.
UPDATE "Vendor"
SET "deliveryModels" = (
      SELECT ARRAY(
        SELECT DISTINCT unnest(
          COALESCE("deliveryModels", ARRAY[]::"VendorDeliveryModel"[])
          || ARRAY['saas']::"VendorDeliveryModel"[]
        )
      )
    ),
    "category" = 'other',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "category" = 'software_as_a_service';

-- Deterministic remaps. No delivery model is inferred: neither value said
-- anything reliable about how the vendor is consumed.
UPDATE "Vendor"
SET "category" = 'cloud_infrastructure',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "category" IN ('cloud', 'infrastructure');

UPDATE "Vendor"
SET "category" = 'hr_recruiting',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "category" = 'hr';


-- The same retired values are reachable through discovery candidates, whose
-- resolvedCategory seeds the vendor created on approval.
UPDATE "DiscoveredVendorCandidate"
SET "resolvedCategory" = 'cloud_infrastructure',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "resolvedCategory" IN ('cloud', 'infrastructure');

UPDATE "DiscoveredVendorCandidate"
SET "resolvedCategory" = 'hr_recruiting',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "resolvedCategory" = 'hr';

-- No review row here: an unapproved candidate has no vendor to attach one to, and
-- approval routes through the same classification UI as any new vendor.
UPDATE "DiscoveredVendorCandidate"
SET "resolvedCategory" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "resolvedCategory" = 'software_as_a_service';
