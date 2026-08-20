// Static catalog validation for the framework seed data. Runs without a
// database: it cross-checks the JSON primitives/relations against each other
// and against the canonical TSC / ISO 27001:2022 identifier lists.
//
//   bun prisma/seed/validation/validate.ts
//
// Exit code 1 when any error-level finding exists. Warning-level findings are
// reported but do not fail the run (used for out-of-audit-scope coverage).

import fs from 'node:fs';
import path from 'node:path';
import {
  ISO_ANNEX_A,
  ISO_CLAUSES,
  TSC_CRITERIA,
  TSC_ERROR_CATEGORIES,
} from './expected-identifiers';

// ---------------------------------------------------------------- scope config

/** Frameworks the catalog must be complete for (the visible rows). */
const IN_SCOPE_FRAMEWORKS: Record<string, 'SOC2' | 'ISO27001'> = {
  frk_683f377429b8408d1c85f9bd: 'SOC2',
  frk_681ecc34e85064efdbb76993: 'ISO27001',
};

/** Tasks that are wiring placeholders, not real evidence. A control whose only
 * task is one of these counts as having no evidence path. */
const PLACEHOLDER_TASK_IDS = new Set([
  'frk_tt_68e52a484cad0014de7a628f', // "Separation of Environments" (bulk-linked to every control)
]);

// -------------------------------------------------------------------- loading

interface FrameworkRow {
  id: string;
  name: string;
  visible: boolean;
}
interface RequirementRow {
  id: string;
  frameworkId: string;
  identifier: string;
  name: string;
}
interface ControlRow {
  id: string;
  name: string;
  documentTypes?: string[];
}
interface NamedRow {
  id: string;
  name: string;
}
interface RelationRow {
  A: string;
  B: string;
}

const seedDir = path.join(__dirname, '..');
const loadJson = <T>(...segments: string[]): T[] =>
  JSON.parse(fs.readFileSync(path.join(seedDir, ...segments), 'utf-8')) as T[];

const frameworks = loadJson<FrameworkRow>('primitives', 'FrameworkEditorFramework.json');
const requirements = loadJson<RequirementRow>('primitives', 'FrameworkEditorRequirement.json');
const controls = loadJson<ControlRow>('primitives', 'FrameworkEditorControlTemplate.json');
const policies = loadJson<NamedRow>('primitives', 'FrameworkEditorPolicyTemplate.json');
const tasks = loadJson<NamedRow>('primitives', 'FrameworkEditorTaskTemplate.json');
const relControlRequirement = loadJson<RelationRow>(
  'relations',
  '_FrameworkEditorControlTemplateToFrameworkEditorRequirement.json',
);
const relControlPolicy = loadJson<RelationRow>(
  'relations',
  '_FrameworkEditorControlTemplateToFrameworkEditorPolicyTemplate.json',
);
const relControlTask = loadJson<RelationRow>(
  'relations',
  '_FrameworkEditorControlTemplateToFrameworkEditorTaskTemplate.json',
);

// ------------------------------------------------------------------ reporting

const errors: string[] = [];
const warnings: string[] = [];
const error = (code: string, message: string) => errors.push(`[${code}] ${message}`);
const warn = (code: string, message: string) => warnings.push(`[${code}] ${message}`);

// -------------------------------------------------------- referential checks

const controlIds = new Set(controls.map((c) => c.id));
const requirementIds = new Set(requirements.map((r) => r.id));
const policyIds = new Set(policies.map((p) => p.id));
const taskIds = new Set(tasks.map((t) => t.id));

const checkRelation = (
  label: string,
  rows: RelationRow[],
  validA: Set<string>,
  validB: Set<string>,
) => {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!validA.has(row.A)) error('REF', `${label}: unknown A-side id ${row.A}`);
    if (!validB.has(row.B)) error('REF', `${label}: unknown B-side id ${row.B}`);
    const key = `${row.A}::${row.B}`;
    if (seen.has(key)) error('DUP', `${label}: duplicate pair ${key}`);
    seen.add(key);
  }
};

checkRelation('control↔requirement', relControlRequirement, controlIds, requirementIds);
checkRelation('control↔policy', relControlPolicy, controlIds, policyIds);
checkRelation('control↔task', relControlTask, controlIds, taskIds);

// ------------------------------------------------- framework visibility check

const visibleByName = new Map<string, FrameworkRow[]>();
for (const fw of frameworks.filter((f) => f.visible)) {
  const key = fw.name.trim().toLowerCase();
  visibleByName.set(key, [...(visibleByName.get(key) ?? []), fw]);
}
for (const [name, rows] of visibleByName) {
  if (rows.length > 1) {
    error('VIS', `multiple visible frameworks named "${name}": ${rows.map((r) => r.id).join(', ')}`);
  }
}

// --------------------------------------------- per-framework coverage checks

const controlsByRequirement = new Map<string, string[]>();
for (const row of relControlRequirement) {
  controlsByRequirement.set(row.B, [...(controlsByRequirement.get(row.B) ?? []), row.A]);
}

const tasksByControl = new Map<string, string[]>();
for (const row of relControlTask) {
  tasksByControl.set(row.A, [...(tasksByControl.get(row.A) ?? []), row.B]);
}

const controlById = new Map(controls.map((c) => [c.id, c]));
const inScopeControlIds = new Set<string>();

for (const [frameworkId, label] of Object.entries(IN_SCOPE_FRAMEWORKS)) {
  const fwRequirements = requirements.filter((r) => r.frameworkId === frameworkId);

  // Identifier hygiene: whitespace corruption and duplicates.
  const seenIdentifiers = new Map<string, number>();
  for (const req of fwRequirements) {
    if (req.identifier !== req.identifier.trim()) {
      error('WS', `${label} requirement ${req.id}: identifier has stray whitespace: ${JSON.stringify(req.identifier)}`);
    }
    const ident = req.identifier.trim();
    seenIdentifiers.set(ident, (seenIdentifiers.get(ident) ?? 0) + 1);
  }
  for (const [ident, count] of seenIdentifiers) {
    if (count > 1) error('REQDUP', `${label}: identifier "${ident}" appears ${count} times`);
  }

  // Every requirement needs at least one control.
  for (const req of fwRequirements) {
    const mapped = controlsByRequirement.get(req.id) ?? [];
    if (mapped.length === 0) {
      error('COV', `${label} ${req.identifier.trim()}: no control mapped`);
    }
    for (const controlId of mapped) inScopeControlIds.add(controlId);
  }

  // Expected-identifier completeness.
  const present = new Set([...seenIdentifiers.keys()]);
  if (label === 'SOC2') {
    for (const [category, idents] of Object.entries(TSC_CRITERIA)) {
      const missing = idents.filter((i) => !present.has(i));
      if (missing.length === 0) continue;
      const report = TSC_ERROR_CATEGORIES.includes(category) ? error : warn;
      report('TSC', `${label}: missing ${category} criteria: ${missing.join(', ')}`);
    }
    const known = new Set(Object.values(TSC_CRITERIA).flat());
    for (const ident of present) {
      if (!known.has(ident)) warn('TSC', `${label}: unknown criterion identifier "${ident}"`);
    }
  } else {
    const missingAnnex = ISO_ANNEX_A.filter((i) => !present.has(i));
    if (missingAnnex.length > 0) {
      error('ISO', `${label}: missing Annex A controls: ${missingAnnex.join(', ')}`);
    }
    const missingClauses = ISO_CLAUSES.filter((i) => !present.has(i));
    if (missingClauses.length > 0) {
      warn('ISO', `${label}: missing management clauses: ${missingClauses.join(', ')}`);
    }
    const known = new Set([...ISO_ANNEX_A, ...ISO_CLAUSES]);
    for (const ident of present) {
      if (!known.has(ident)) warn('ISO', `${label}: unknown identifier "${ident}"`);
    }
  }
}

// ------------------------------------------- per-control evidence-path checks

for (const controlId of [...inScopeControlIds].sort()) {
  const control = controlById.get(controlId);
  if (!control) continue; // REF check already reported it
  const controlTasks = tasksByControl.get(controlId) ?? [];
  const realTasks = controlTasks.filter((t) => !PLACEHOLDER_TASK_IDS.has(t));
  if (realTasks.length === 0) {
    error('TASK', `control "${control.name.trim()}" (${controlId}): no non-placeholder evidence task`);
  }
  // Warning only: evidence is primarily task-driven, and the EvidenceFormType
  // enum does not (yet) have a sensible value for every control.
  if (!control.documentTypes || control.documentTypes.length === 0) {
    warn('DOC', `control "${control.name.trim()}" (${controlId}): no documentTypes`);
  }
}

// In-scope control templates must have unique names — duplicate names make
// name-based tooling and the editor UI ambiguous (and have caused mis-wiring).
const inScopeNames = new Map<string, string[]>();
for (const controlId of inScopeControlIds) {
  const name = controlById.get(controlId)?.name.trim().toLowerCase();
  if (!name) continue;
  inScopeNames.set(name, [...(inScopeNames.get(name) ?? []), controlId]);
}
for (const [name, ids] of inScopeNames) {
  if (ids.length > 1) error('CTDUP', `duplicate in-scope control name "${name}": ${ids.join(', ')}`);
}

// --------------------------------------------------------------------- output

const summarize = (list: string[], heading: string) => {
  if (list.length === 0) return;
  console.log(`\n${heading} (${list.length}):`);
  for (const item of list) console.log(`  ${item}`);
};

summarize(errors, 'ERRORS');
summarize(warnings, 'WARNINGS');
console.log(`\nCatalog validation: ${errors.length} error(s), ${warnings.length} warning(s).`);

if (errors.length > 0) process.exit(1);
