// Reconciles a live database against the seed JSON for a set of frameworks.
//
//   bun prisma/seed/prune/reconcile.ts                # dry run, reports only
//   bun prisma/seed/prune/reconcile.ts --apply        # performs the removals
//
// Why this exists: seed.ts is connect-only. It upserts rows and connects
// relations but never disconnects, so a long-lived database accumulates every
// link any past seed run ever created. The static prune manifest only covers
// links that were present in the repo JSON when it was generated — it cannot
// know about links that exist solely in that database's history.
//
// This script derives the removals from the live data instead: anything the
// database has for these frameworks that the seed JSON does not declare is
// surplus, and is reported (or removed with --apply). Requirement rows are only
// deleted when no organization data still references them.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';
import path from 'node:path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes('--apply');

/** Frameworks whose catalog the seed JSON is the source of truth for. */
const IN_SCOPE_FRAMEWORK_IDS = [
  'frk_683f377429b8408d1c85f9bd', // SOC 2
  'frk_681ecc34e85064efdbb76993', // ISO 27001
];

interface Row {
  id: string;
  frameworkId?: string;
}
interface Relation {
  A: string;
  B: string;
}

const seedDir = path.join(__dirname, '..');
const load = <T>(...segments: string[]): T[] =>
  JSON.parse(fs.readFileSync(path.join(seedDir, ...segments), 'utf-8')) as T[];

const requirements = load<Row>('primitives', 'FrameworkEditorRequirement.json');
const relControlRequirement = load<Relation>(
  'relations',
  '_FrameworkEditorControlTemplateToFrameworkEditorRequirement.json',
);
const relControlPolicy = load<Relation>(
  'relations',
  '_FrameworkEditorControlTemplateToFrameworkEditorPolicyTemplate.json',
);
const relControlTask = load<Relation>(
  'relations',
  '_FrameworkEditorControlTemplateToFrameworkEditorTaskTemplate.json',
);

const pair = (a: string, b: string) => `${a}::${b}`;

async function reconcileFramework(frameworkId: string) {
  const framework = await prisma.frameworkEditorFramework.findUnique({
    where: { id: frameworkId },
    select: { id: true, name: true },
  });
  if (!framework) {
    console.warn(`framework ${frameworkId} not found — skipping.`);
    return;
  }
  console.log(`\n=== ${framework.name} (${frameworkId})`);

  // ---- requirements the JSON declares for this framework
  const desiredRequirementIds = new Set(
    requirements.filter((r) => r.frameworkId === frameworkId).map((r) => r.id),
  );

  const liveRequirements = await prisma.frameworkEditorRequirement.findMany({
    where: { frameworkId },
    select: { id: true, identifier: true, name: true },
  });
  const surplusRequirements = liveRequirements.filter(
    (r) => !desiredRequirementIds.has(r.id),
  );

  console.log(
    `requirements: ${liveRequirements.length} live, ${desiredRequirementIds.size} declared, ${surplusRequirements.length} surplus`,
  );

  // ---- control<->requirement links, scoped to this framework's requirements
  const desiredControlLinks = new Set(
    relControlRequirement
      .filter((r) => desiredRequirementIds.has(r.B))
      .map((r) => pair(r.A, r.B)),
  );

  const liveControls = await prisma.frameworkEditorControlTemplate.findMany({
    where: { requirements: { some: { frameworkId } } },
    select: { id: true, name: true, requirements: { select: { id: true } } },
  });

  const surplusControlLinks: { controlId: string; requirementId: string }[] = [];
  for (const control of liveControls) {
    for (const req of control.requirements) {
      // Only judge links into THIS framework; a control may legitimately map
      // to requirements of other frameworks.
      const belongsToFramework =
        desiredRequirementIds.has(req.id) ||
        surplusRequirements.some((r) => r.id === req.id);
      if (!belongsToFramework) continue;
      if (desiredControlLinks.has(pair(control.id, req.id))) continue;
      surplusControlLinks.push({ controlId: control.id, requirementId: req.id });
    }
  }

  const desiredControlIds = new Set(
    [...desiredControlLinks].map((key) => key.split('::')[0]!),
  );
  const controlsAfter = new Set(
    liveControls
      .map((c) => c.id)
      .filter((id) => desiredControlIds.has(id)),
  );
  console.log(
    `controls: ${liveControls.length} live, ${desiredControlIds.size} declared, ` +
      `${liveControls.length - controlsAfter.size} would drop off this framework`,
  );
  console.log(`control→requirement links to remove: ${surplusControlLinks.length}`);

  // ---- policy / task links for controls that remain in scope
  const desiredPolicy = new Set(relControlPolicy.map((r) => pair(r.A, r.B)));
  const desiredTask = new Set(relControlTask.map((r) => pair(r.A, r.B)));

  const scopedLinks = await prisma.frameworkEditorControlTemplate.findMany({
    where: { id: { in: [...desiredControlIds] } },
    select: {
      id: true,
      policyTemplates: { select: { id: true } },
      taskTemplates: { select: { id: true } },
    },
  });

  const surplusPolicyLinks: { controlId: string; policyId: string }[] = [];
  const surplusTaskLinks: { controlId: string; taskId: string }[] = [];
  for (const control of scopedLinks) {
    for (const p of control.policyTemplates) {
      if (!desiredPolicy.has(pair(control.id, p.id))) {
        surplusPolicyLinks.push({ controlId: control.id, policyId: p.id });
      }
    }
    for (const t of control.taskTemplates) {
      if (!desiredTask.has(pair(control.id, t.id))) {
        surplusTaskLinks.push({ controlId: control.id, taskId: t.id });
      }
    }
  }
  console.log(`control→policy links to remove: ${surplusPolicyLinks.length}`);
  console.log(`control→task links to remove: ${surplusTaskLinks.length}`);

  if (surplusRequirements.length > 0) {
    console.log('surplus requirements:');
    for (const r of surplusRequirements) {
      console.log(`  ${r.identifier} — ${r.name.slice(0, 70)} (${r.id})`);
    }
  }

  if (!APPLY) return;

  // ---- apply -------------------------------------------------------------
  for (const link of surplusControlLinks) {
    await prisma.frameworkEditorControlTemplate.update({
      where: { id: link.controlId },
      data: { requirements: { disconnect: { id: link.requirementId } } },
    });
  }
  for (const link of surplusPolicyLinks) {
    await prisma.frameworkEditorControlTemplate.update({
      where: { id: link.controlId },
      data: { policyTemplates: { disconnect: { id: link.policyId } } },
    });
    await prisma.frameworkEditorControlPolicyTemplateLink.deleteMany({
      where: {
        frameworkId,
        controlTemplateId: link.controlId,
        policyTemplateId: link.policyId,
      },
    });
  }
  for (const link of surplusTaskLinks) {
    await prisma.frameworkEditorControlTemplate.update({
      where: { id: link.controlId },
      data: { taskTemplates: { disconnect: { id: link.taskId } } },
    });
    await prisma.frameworkEditorControlTaskTemplateLink.deleteMany({
      where: {
        frameworkId,
        controlTemplateId: link.controlId,
        taskTemplateId: link.taskId,
      },
    });
  }
  // Framework-scoped rows for controls that no longer belong to the framework
  // at all would otherwise linger and reappear in the manifest.
  await prisma.frameworkEditorControlPolicyTemplateLink.deleteMany({
    where: { frameworkId, controlTemplateId: { notIn: [...desiredControlIds] } },
  });
  await prisma.frameworkEditorControlTaskTemplateLink.deleteMany({
    where: { frameworkId, controlTemplateId: { notIn: [...desiredControlIds] } },
  });
  await prisma.frameworkEditorControlDocumentTypeLink.deleteMany({
    where: { frameworkId, controlTemplateId: { notIn: [...desiredControlIds] } },
  });

  for (const r of surplusRequirements) {
    const referenced = await prisma.requirementMap.count({
      where: { requirementId: r.id },
    });
    if (referenced > 0) {
      console.warn(
        `requirement ${r.identifier} (${r.id}): referenced by ${referenced} org requirement map(s) — kept.`,
      );
      continue;
    }
    await prisma.frameworkEditorRequirement.delete({ where: { id: r.id } });
    console.log(`requirement ${r.identifier} (${r.id}): deleted.`);
  }

  console.log('applied.');
}

async function main() {
  console.log(APPLY ? 'MODE: apply' : 'MODE: dry run (pass --apply to perform removals)');
  for (const frameworkId of IN_SCOPE_FRAMEWORK_IDS) {
    await reconcileFramework(frameworkId);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Reconcile failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
