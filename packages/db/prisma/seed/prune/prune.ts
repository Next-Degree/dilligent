// Applies a prune manifest to the database. The seed (seed.ts) is
// connect-only: it can create rows and connect relations but never
// disconnects or deletes. This script is its counterpart — run it AFTER the
// seed so the JSON files in prisma/seed become fully declarative.
//
//   bun prisma/seed/prune/prune.ts prune-2026-08-soc2-iso-uplift.json
//
// Safe to re-run: disconnects of already-absent relations are no-ops, and
// requirement deletion is skipped when live org data still references the row
// (framework version sync reconciles those on the org's next update).

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';
import path from 'node:path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface PruneManifest {
  controlRequirement: [string, string][];
  controlTask: [string, string][];
  controlPolicy: [string, string][];
  deletedRequirementIds: string[];
  notes: string[];
}

const manifestName = process.argv[2];
if (!manifestName) {
  console.error('Usage: bun prisma/seed/prune/prune.ts <manifest.json>');
  process.exit(1);
}
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, manifestName), 'utf-8'),
) as PruneManifest;

async function disconnectPairs({
  pairs,
  relationField,
  label,
}: {
  pairs: [string, string][];
  relationField: 'requirements' | 'taskTemplates' | 'policyTemplates';
  label: string;
}) {
  let done = 0;
  for (const [controlId, targetId] of pairs) {
    try {
      await prisma.frameworkEditorControlTemplate.update({
        where: { id: controlId },
        data: { [relationField]: { disconnect: { id: targetId } } },
      });
      done++;
    } catch (err) {
      console.warn(`${label}: could not disconnect ${controlId} -> ${targetId}:`, err);
    }
  }
  console.log(`${label}: ${done}/${pairs.length} disconnected.`);
}

async function deleteRequirements(ids: string[]) {
  for (const id of ids) {
    const referenced = await prisma.requirementMap.count({ where: { requirementId: id } });
    if (referenced > 0) {
      console.warn(
        `requirement ${id}: still referenced by ${referenced} org requirement map(s) — skipping delete; framework sync will reconcile.`,
      );
      continue;
    }
    try {
      await prisma.frameworkEditorRequirement.delete({ where: { id } });
      console.log(`requirement ${id}: deleted.`);
    } catch (err) {
      console.warn(`requirement ${id}: delete failed:`, err);
    }
  }
}

async function main() {
  await disconnectPairs({
    pairs: manifest.controlRequirement,
    relationField: 'requirements',
    label: 'control<->requirement',
  });
  await disconnectPairs({
    pairs: manifest.controlTask,
    relationField: 'taskTemplates',
    label: 'control<->task',
  });
  await disconnectPairs({
    pairs: manifest.controlPolicy,
    relationField: 'policyTemplates',
    label: 'control<->policy',
  });
  await deleteRequirements(manifest.deletedRequirementIds);
  await prisma.$disconnect();
  console.log('Prune complete.');
}

main().catch(async (err) => {
  console.error('Prune failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
