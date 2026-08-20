// Re-points organization requirement mappings from one framework requirement
// onto another, then removes the now-unreferenced source requirement.
//
//   bun prisma/seed/prune/remap-requirement.ts --from <reqId> --to <reqId>
//   bun prisma/seed/prune/remap-requirement.ts --from <reqId> --to <reqId> --apply
//
// Needed when the seed merges two requirement rows into one (e.g. a nonstandard
// 9.1.1 / 9.1.2 split collapsed into 9.1). Reconcile deliberately refuses to
// delete a requirement that organization data still points at, because
// RequirementMap cascades on delete and would silently drop those orgs'
// control mappings. This moves the mappings across first so the delete is safe.
//
// RequirementMap is unique on (controlId, frameworkInstanceId, requirementId),
// so a row whose target already exists for the same control and instance would
// collide on update; those rows are redundant and are dropped instead.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes('--apply');
const argValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const fromId = argValue('--from');
const toId = argValue('--to');

if (!fromId || !toId) {
  console.error(
    'Usage: bun prisma/seed/prune/remap-requirement.ts --from <reqId> --to <reqId> [--apply]',
  );
  process.exit(1);
}

async function main() {
  console.log(APPLY ? 'MODE: apply' : 'MODE: dry run (pass --apply to perform changes)');

  const [from, to] = await Promise.all([
    prisma.frameworkEditorRequirement.findUnique({ where: { id: fromId } }),
    prisma.frameworkEditorRequirement.findUnique({ where: { id: toId } }),
  ]);

  if (!from) throw new Error(`source requirement ${fromId} not found`);
  if (!to) throw new Error(`target requirement ${toId} not found`);
  if (from.frameworkId !== to.frameworkId) {
    throw new Error(
      `refusing to remap across frameworks: ${from.frameworkId} -> ${to.frameworkId}`,
    );
  }

  console.log(`from: ${from.identifier} (${from.id})`);
  console.log(`to:   ${to.identifier} (${to.id})`);

  const maps = await prisma.requirementMap.findMany({
    where: { requirementId: fromId },
    select: { id: true, controlId: true, frameworkInstanceId: true },
  });
  console.log(`organization requirement maps pointing at source: ${maps.length}`);

  const toMove: string[] = [];
  const toDrop: string[] = [];
  for (const map of maps) {
    const clash = await prisma.requirementMap.findFirst({
      where: {
        requirementId: toId,
        controlId: map.controlId,
        frameworkInstanceId: map.frameworkInstanceId,
      },
      select: { id: true },
    });
    (clash ? toDrop : toMove).push(map.id);
  }
  console.log(`  to re-point: ${toMove.length}`);
  console.log(`  redundant (target already mapped), to delete: ${toDrop.length}`);

  if (!APPLY) {
    console.log('\nDry run only — nothing changed.');
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (toMove.length > 0) {
      await tx.requirementMap.updateMany({
        where: { id: { in: toMove } },
        data: { requirementId: toId },
      });
    }
    if (toDrop.length > 0) {
      await tx.requirementMap.deleteMany({ where: { id: { in: toDrop } } });
    }
    await tx.frameworkEditorRequirement.delete({ where: { id: fromId } });
  });

  console.log(
    `Re-pointed ${toMove.length}, deleted ${toDrop.length} redundant, removed requirement ${from.identifier}.`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Remap failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
