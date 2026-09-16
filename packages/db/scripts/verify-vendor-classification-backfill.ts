/**
 * Proves the vendor classification backfill against a real database.
 *
 *   DATABASE_URL=postgres://... bun scripts/verify-vendor-classification-backfill.ts
 *
 * Seeds vendors carrying every retired category value, re-runs the backfill from
 * 20260904000100_vendor_classification_backfill, and asserts the outcome. The
 * whole run happens inside a transaction that is ALWAYS rolled back, so it is
 * safe to point at any environment — including one with real data, where it
 * doubles as a check that the migration would behave on that data.
 *
 * Re-running the backfill on an already-migrated database is exactly what this
 * exercises, so it also proves the migration is idempotent.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const BACKFILL_SQL = join(
  __dirname,
  '../prisma/migrations/20260904000100_vendor_classification_backfill/migration.sql',
);

interface Check {
  name: string;
  actual: unknown;
  expected: unknown;
}

const checks: Check[] = [];

function expect({
  name,
  actual,
  expected,
}: {
  name: string;
  actual: unknown;
  expected: unknown;
}): void {
  checks.push({ name, actual, expected });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');

    // Scoped to one throwaway organisation so the assertions below cannot be
    // perturbed by whatever else lives in the target database.
    const org = await client.query<{ id: string }>(
      `INSERT INTO "Organization" (name) VALUES ('vendor-classification-verify') RETURNING id`,
    );
    const organizationId = org.rows[0].id;

    const seeded: Array<{ name: string; category: string }> = [
      { name: 'AWS', category: 'cloud' },
      { name: 'GCP', category: 'infrastructure' },
      { name: 'Slack', category: 'software_as_a_service' },
      { name: 'Clearbit', category: 'software_as_a_service' },
      { name: 'Rippling', category: 'hr' },
      { name: 'Stripe', category: 'finance' },
      { name: 'Hubspot', category: 'marketing' },
      { name: 'Salesforce', category: 'sales' },
      { name: 'Misc', category: 'other' },
    ];

    for (const vendor of seeded) {
      await client.query(
        `INSERT INTO "Vendor" (name, description, category, "organizationId", "updatedAt")
         VALUES ($1, $2, $3::"VendorCategory", $4, CURRENT_TIMESTAMP)`,
        [vendor.name, `${vendor.name} seeded by verification`, vendor.category, organizationId],
      );
    }

    const before = await client.query<{ count: string }>(
      `SELECT count(*) FROM "Vendor" WHERE "organizationId" = $1`,
      [organizationId],
    );

    await client.query(readFileSync(BACKFILL_SQL, 'utf8'));

    const after = await client.query<{ count: string }>(
      `SELECT count(*) FROM "Vendor" WHERE "organizationId" = $1`,
      [organizationId],
    );
    expect({
      name: 'no vendor rows lost',
      actual: after.rows[0].count,
      expected: before.rows[0].count,
    });

    const retired = await client.query<{ count: string }>(
      `SELECT count(*) FROM "Vendor"
       WHERE "organizationId" = $1
         AND "category"::text IN ('cloud','infrastructure','software_as_a_service','hr')`,
      [organizationId],
    );
    expect({
      name: 'no row retains a retired category',
      actual: retired.rows[0].count,
      expected: '0',
    });

    const nulls = await client.query<{ count: string }>(
      `SELECT count(*) FROM "Vendor"
       WHERE "organizationId" = $1
         AND ("deliveryModels" IS NULL OR "dataServiceTypes" IS NULL OR "dataFlowRoles" IS NULL)`,
      [organizationId],
    );
    expect({
      name: 'list columns are never null',
      actual: nulls.rows[0].count,
      expected: '0',
    });

    const remapped = await client.query<{ name: string; category: string }>(
      `SELECT name, category::text AS category FROM "Vendor"
       WHERE "organizationId" = $1 AND name IN ('AWS','GCP','Rippling')
       ORDER BY name`,
      [organizationId],
    );
    expect({
      name: 'cloud and infrastructure collapse into cloud_infrastructure, hr into hr_recruiting',
      actual: remapped.rows.map((row) => `${row.name}=${row.category}`).join(','),
      expected: 'AWS=cloud_infrastructure,GCP=cloud_infrastructure,Rippling=hr_recruiting',
    });

    const saas = await client.query<{ name: string; category: string; models: string[] }>(
      `SELECT name, category::text AS category, "deliveryModels"::text[] AS models
       FROM "Vendor"
       WHERE "organizationId" = $1 AND name IN ('Slack','Clearbit')
       ORDER BY name`,
      [organizationId],
    );
    expect({
      name: 'SaaS becomes a delivery model, never a category',
      actual: saas.rows
        .map((row) => `${row.name}=${row.category}/${row.models.join('|')}`)
        .join(','),
      expected: 'Clearbit=other/saas,Slack=other/saas',
    });

    const preserved = await client.query<{ name: string; category: string }>(
      `SELECT name, category::text AS category FROM "Vendor"
       WHERE "organizationId" = $1 AND name IN ('Stripe','Hubspot','Salesforce','Misc')
       ORDER BY name`,
      [organizationId],
    );
    expect({
      name: 'finance, marketing, sales and other are preserved unchanged',
      actual: preserved.rows.map((row) => `${row.name}=${row.category}`).join(','),
      expected: 'Hubspot=marketing,Misc=other,Salesforce=sales,Stripe=finance',
    });

    const review = await client.query<{ count: string }>(
      `SELECT count(*) FROM "VendorClassificationReview" r
       JOIN "Vendor" v ON v.id = r."vendorId"
       WHERE v."organizationId" = $1 AND r."resolvedAt" IS NULL`,
      [organizationId],
    );
    expect({
      name: 'every ambiguous row is queued for manual classification',
      actual: review.rows[0].count,
      expected: '2',
    });

    // Second application must change nothing — operators re-run migrations.
    await client.query(readFileSync(BACKFILL_SQL, 'utf8'));
    const reviewAgain = await client.query<{ count: string }>(
      `SELECT count(*) FROM "VendorClassificationReview" r
       JOIN "Vendor" v ON v.id = r."vendorId"
       WHERE v."organizationId" = $1`,
      [organizationId],
    );
    expect({
      name: 'backfill is idempotent (no duplicate review rows on re-run)',
      actual: reviewAgain.rows[0].count,
      expected: '2',
    });
  } finally {
    // Never leave the fixture behind, even on failure.
    await client.query('ROLLBACK');
    await client.end();
  }

  const failures = checks.filter((check) => String(check.actual) !== String(check.expected));
  for (const check of checks) {
    const ok = String(check.actual) === String(check.expected);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.name}`);
    if (!ok) {
      console.log(`      expected: ${String(check.expected)}`);
      console.log(`      actual:   ${String(check.actual)}`);
    }
  }
  console.log(`\n${checks.length - failures.length}/${checks.length} checks passed.`);
  if (failures.length > 0) process.exit(1);
}

void main();
