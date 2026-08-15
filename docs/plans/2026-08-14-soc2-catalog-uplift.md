# SOC 2 Catalog Uplift

**Status:** Draft — pending review
**Date:** 2026-08-14
**Branch:** `claude/soc2-controls-inventory-g4wq1x`
**Scope:** SOC 2 framework `frk_683f377429b8408d1c85f9bd` ("SOC 2", the only `visible: true` SOC 2 row)

## Goal

Make the self-hosted dilligent instance the system of record for our own SOC 2
Type II audit, replacing a commercial GRC subscription. That
requires the SOC 2 catalog to be:

1. **Complete** — every Trust Services Criterion in scope maps to at least one
   control (today five domains have no counterpart at all).
2. **Evidenced** — every control carries purpose-built evidence tasks and
   document types, not the shared placeholder task wired to all 35 controls today.
3. **Machine-validated** — a CI gate keeps the catalog from silently rotting.
4. **Safely deployable** — changes reach the live platform through the existing
   FrameworkVersion publish/sync pipeline, with rollback.

## Background

A gap analysis (2026-08-14) compared the seeded SOC 2 catalog (35 controls)
against an external 80-control GRC Tools catalog. Findings:

- **Missing domains:** board governance (CC1.2–1.4), System Description (the
  Type II report deliverable), customer-facing communications (CC2.3),
  control self-assessment, mobile device management.
- **Under-split controls:** access/credential controls collapse 13 external
  controls into 2, losing separately evidenced assertions (password policy,
  remote-access MFA, remote-access encryption, per-tier prod access).
- **Broken evidence wiring:** the "Separation of Environments" task is linked
  to all 35 controls; the Vulnerability Management control has no scan task
  (the only scan-evidence task is wired to a PCI control); most SOC 2 controls
  have empty `documentTypes`.
- **Framework-row buildup:** four `visible: false` SOC 2 framework rows
  (v.1, 1.0.0, Type 1, v2) are dead test data.

## Targets

| Target | Measure |
| --- | --- |
| TSC coverage | Every criterion in scope (Security + Availability; Confidentiality TBD with consultant) maps to ≥1 control |
| Control count | ~45–50 controls, each a single testable assertion |
| Evidence wiring | Every control has ≥1 non-placeholder task; document types populated |
| Discoverability | All controls assigned to a `FrameworkControlFamily` (domain grouping); TSC identifiers visible per control |
| Catalog integrity | CI validation script passes; runs on every PR touching seed data |
| Rollout | Published as FrameworkVersion 2.0.0; our org instance synced with rollback window; no other org affected until it syncs |
| Ops hardening | Dead-man alerting on evidence jobs; DB backups with a tested restore |

## Phase 0 — Tooling (repo, prerequisite for everything else)

- **Validation script** (`packages/db/prisma/seed/validate.ts` or similar),
  wired into CI. Fails on:
  - a TSC criterion in scope with no mapped control;
  - a control with zero evidence tasks, or whose only task is a
    designated placeholder;
  - relation rows referencing nonexistent IDs;
  - more than one `visible: true` framework row per framework name.
- **Drift check**: script to dump live `FrameworkEditor*` tables and diff
  against the repo JSON. Must be run (and reconciled) before the first live
  seed run — the seed upserts by ID and will overwrite live edits made
  through the Framework Editor UI.
- **Prune script**: the seed is connect-only (it never disconnects relations
  or deletes rows). A companion script applies declarative removals so the
  JSON becomes the actual source of truth. First uses: unlink "Separation of
  Environments" from ~34 controls; archive the four dead SOC 2 framework rows.

## Phase 1 — Catalog fixes (seed JSON, priority-ordered)

1. **Wire real vulnerability-scan evidence to "Vulnerability Management".**
   Cheap, high audit value — the control currently has no evidence path.
   Acceptance: a scan-evidence task (recurring, automatable via integrations)
   linked to the SOC 2 control, not just the PCI one.
2. **Add board-governance controls** — charter, meeting cadence, oversight
   briefings, board expertise. Closes the CC1.2–1.4 hole auditors flag first.
   Uses existing `EvidenceFormType.board_meeting`.
3. **Add a "System Description" control/deliverable** — the Section III
   document the Type II report is built on. Without it nothing in the catalog
   produces the report's own prerequisite.
4. **Add customer-facing communications controls** — status page, release
   notes/change log, support channel, published commitments. Covers CC2.3 and
   the availability-commitments narrative.
5. **Split overloaded access/credential controls** into separately evidenced
   assertions: password policy enforced, remote-access MFA, remote-access
   encryption, production app/DB/network access restricted (tracked
   separately). Target granularity: one control = one testable assertion.
6. **Add vendor-risk-tiering evidence to Supplier Security** — vendor list
   maintained, risk levels assigned, security assessments for high-risk
   vendors. Splits agreements from the management program.
7. **Populate document types across all SOC 2 controls.** The model already
   exists (`ControlDocumentType`, `EvidenceFormType`, per-instance links
   backfilled by the seed) and 27/204 templates already use it — this is seed
   data work plus a small enum extension (candidates: insurance policy,
   termination checklist, org chart, board charter, vendor register,
   restore-test record).
8. **Replace the universal placeholder task** with per-control evidence tasks
   (done incrementally alongside items 1–7; prune script removes old links).
9. **Assign every control to a control family** (Access, Governance, HR,
   Change, Monitoring, Resilience, Vendor, Privacy…) for GRC Tools-grade
   navigation. Add MDM/self-assessment controls under the appropriate family.

## Phase 2 — Control↔Risk relation (app code, fast-follow)

**Evaluation outcome (2026-08-14): do it, as a direct relation.** The original
"if/when a risk register model exists" framing is moot — the register exists
(`Risk` model: org-scoped, categories, treatment strategies, acceptances,
AI-generated mitigation plans, AI auto-link infrastructure). What's missing is
the relation:

- Today risks link to **tasks** and findings only. Controls link to tasks. So
  control↔risk exists only transitively, which cannot express "these controls
  are the treatment for this risk."
- Audit value: CC3.1–3.4 want the risk assessment tied to responsive controls.
  The ISO 27001 Risk Treatment Plan (ISMS module) already promises "treatment,
  controls, owner, residual risk" per risk — the schema can't currently
  deliver the "controls" part. One relation serves both frameworks.
- Design sketch: explicit org-scoped join model (`RiskControlLink`:
  riskId, controlId, organizationId, createdAt), surfaced on the risk detail
  page (linked controls) and control detail page (linked risks). Extend the
  existing AI auto-link (embeddings already computed for risks/tasks) to
  suggest control links.
- Effort: migration + API endpoints + RBAC + UI + tests — app code, not seed
  data, so it ships as its own PR after Phase 1. Not a blocker for the
  observation window; risk↔task linkage is a workable interim narrative.
- Deferred (Phase 2+): template-layer risk *scenarios* mapped to control
  templates (like the external catalog's 15 scenarios) so new orgs get a
  pre-linked starter register. Revisit after the direct relation lands.

## Phase 3 — Rollout (platform admin + repo)

1. Run the **drift check** against the live DB; reconcile any UI-made edits.
2. Run the **seed** (upsert) and the **prune script** against the live DB.
3. In the platform admin, review the **draft-diff** for the SOC 2 framework —
   the delta must match the PR.
4. **Publish FrameworkVersion 2.0.0** with release notes summarizing the
   catalog changes.
5. **Sync our org's SOC 2 instance** (locked, undoable within the rollback
   window). Verify control families, evidence tasks, and document types render
   correctly. Other orgs are untouched until they sync.
6. **Ops hardening** (same PR series): dead-man alerting on evidence-collection
   jobs (alert on *absence of success*, not just errors — Trigger.dev run
   monitoring), verified DB backup/restore, periodic evidence export to object
   storage, human review cadences duplicated in a real calendar.

## Working agreements

- Repo JSON is the **source of truth** for framework content; the Framework
  Editor UI is for publishing, syncing, and exceptional spot edits. UI edits
  must be exported back to JSON (export script is part of Phase 0 tooling).
- Catalog changes are **frozen once the observation window opens** — anything
  after that goes through the consultant and lands in the next version.

## Open decisions

- **TSC categories in scope:** Security is mandatory; Availability almost
  certainly; Confidentiality driven by customer questionnaire demand. Decide
  with the consultant before the window opens — it shapes the control set.
- **Auditor selection:** needs a firm comfortable with evidence exports from a
  self-hosted system; raise evidence-integrity expectations (admin access,
  audit logging on evidence records) in the intro call.
- **Consultant review checkpoint:** catalog sign-off after Phase 1 / before
  Phase 3 publish — errors are free to fix until the version is published and
  synced.
