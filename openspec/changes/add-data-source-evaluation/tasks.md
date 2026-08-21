# Tasks: Data Source Evaluation

Five phases. Each phase is a usable cut point — the work can stop at the end of
any phase and still leave something the team uses.

- **Phase 1** — declared registry + comparison matrix. Replaces the spreadsheet.
- **Phase 2** — governance recorded and enforced in shadow.
- **Phase 3** — provenance and telemetry. Observed values start appearing.
- **Phase 4** — coverage, signal strength, scoring. The comparison becomes evidential.
- **Phase 5** — demand capture and enforcement flip.

Phase 5's enforcement flip is not optional follow-up work: shipping the
governance guard permanently default-open is worse than not shipping it.

---

## 1. Phase 1 — Registry and declared comparison

- [ ] 1.1 Add `dataSource` permission resource to `packages/auth/src/permissions.ts`
      with `create`, `read`, `update`, `delete`; grant to `owner` and `admin`.
- [ ] 1.2 Add `packages/db/prisma/schema/data-source.prisma`: `DataSource`,
      `DataSourceField`, `DataSourceCostModel`, `DataSourceComplexity`,
      `DataSourceLifecycleEvent`. Prefixed CUIDs (`dsrc`, `dsf`, `dscm`,
      `dscx`, `dsle`).
- [ ] 1.3 Run the migration; confirm the generated SQL creates the prefixed-CUID
      defaults.
- [ ] 1.4 Create `data-sources-catalog/` with a JSON schema and two real seed
      files, following the shape and review conventions of
      `integrations-catalog/`.
- [ ] 1.5 Write the catalog seed command: upsert by slug, replace declared
      metadata only, never touch observed columns.
- [ ] 1.6 Test: seeding twice is idempotent; seeding does not clear observed
      columns; an unknown field in a catalog file fails loudly.
- [ ] 1.7 Create `apps/api/src/data-sources/` module with the registry
      controller — `@Controller({ path: 'admin/data-sources', version: '1' })`,
      `@UseGuards(PlatformAdminGuard)`, `@UseInterceptors(AdminAuditLogInterceptor)`,
      `@ApiExcludeController()`, matching `admin-organizations`.
- [ ] 1.8 Registry endpoints: list, get, create, update, and lifecycle
      transition. Zod/DTO validation; reject a transition with no rationale or
      no review date.
- [ ] 1.9 Cost summary endpoint: declared cost per unit, and the derived
      first-acquisition vs annualized-refresh split.
- [ ] 1.10 Test (Jest): registry CRUD, slug collision, lifecycle validation,
      overdue-review flagging, and a platform-admin-denied case per endpoint.
- [ ] 1.11 Build `apps/app/src/app/(app)/[orgId]/admin/data-sources/`: list
      page and the comparison matrix. Design system only, Carbon icons,
      responsive at 375/768/1280/1920.
- [ ] 1.12 Source detail page with the declared scorecard and the lifecycle
      decision history.
- [ ] 1.13 Add `data-sources` to `AdminSidebar`.
- [ ] 1.14 Matrix must render "not yet measured" distinctly from zero — this is
      the single most common way a comparison table lies.
- [ ] 1.15 Test (Vitest): matrix renders declared values, missing data renders
      as missing, admin-vs-non-admin gating.
- [ ] 1.16 Export endpoint for the comparison, including weight version once
      phase 4 lands (declared-only until then).

## 2. Phase 2 — Governance

- [ ] 2.1 Add `packages/db/prisma/schema/data-source-governance.prisma`:
      `DataSourceLicense` plus an immutable `DataSourceLicenseSnapshot`
      written on every terms change.
- [ ] 2.2 Migration.
- [ ] 2.3 Governance endpoints: record and read license terms; require a
      reviewer and review timestamp.
- [ ] 2.4 Governance tab on the source detail page; unreviewed sources flagged
      in the registry list.
- [ ] 2.5 Implement `DataSourceLicenseGuard` with `shadow` and `enforcing`
      modes behind a feature flag, defaulting to `shadow`.
- [ ] 2.6 Implement the four reuse rules: `prohibited`, `derived_only`,
      `aggregate_only`, `permitted` — including that the acquiring
      organization is never restricted.
- [ ] 2.7 Implement the adjudicative-use gate as a check independent of the
      reuse rule.
- [ ] 2.8 Log every decision, including shadow-mode would-denies, with the
      source, requesting org, rule, and outcome.
- [ ] 2.9 Test: each reuse rule, acquiring-org exemption, missing-terms
      behavior in both modes, adjudicative gate, and that a terms change does
      not retroactively regovern existing values.
- [ ] 2.10 Retention report: values held past their source's ceiling.
- [ ] 2.11 Deletion propagation report: given a subject, which sources carry an
      obligation.

## 3. Phase 3 — Provenance and telemetry

- [ ] 3.1 Add `packages/db/prisma/schema/data-source-provenance.prisma`:
      `FieldProvenance`, `DataSourceUsageEvent`. Index on
      `(subjectId, fieldPath)` and `(dataSourceId, createdAt)`.
- [ ] 3.2 Migration. Confirm the write path can sustain one provenance row per
      field per fetch at expected volume before going further — if it cannot,
      revisit granularity now rather than after backfill.
- [ ] 3.3 Provenance write helper: called at every point a source value is
      persisted, pinning `licenseSnapshotId` at fetch time.
- [ ] 3.4 Wire the helper into `apps/api/src/background-checks/` as the first
      real producer — it is already a paid per-record source with webhook
      delivery and existing staleness markers.
- [ ] 3.5 Usage event recording, including misses, errors, and rate limits as
      distinct outcomes.
- [ ] 3.6 Provenance read API: per-subject field provenance, with unknown
      provenance reported as unknown rather than attributed.
- [ ] 3.7 `DataSourceMetricRollup` model plus a scheduled rollup job (Trigger.dev,
      following existing task conventions).
- [ ] 3.8 Observed cost metrics: per call, per matched record, per useful signal.
- [ ] 3.9 Observed freshness: p50/p95 age at read and share served past TTL,
      per source and per field.
- [ ] 3.10 Per-field TTL and decay profile evaluation: `fresh` / `aging` /
      `stale` / `expired`, with `append_only` never expiring.
- [ ] 3.11 Surface declared-vs-observed on the scorecard with divergence
      highlighting.
- [ ] 3.12 Test: cost derivation including misses, freshness percentiles,
      per-field TTL divergence within one source, append-only handling,
      rollup staleness reporting.

## 4. Phase 4 — Coverage, signals, scoring

- [ ] 4.1 Reference cohort model and management: a labeled, versioned sample
      with segment attributes. Needs a named owner before this phase starts —
      see design.md open question 2.
- [ ] 4.2 Coverage computation: reachability, match rate, completeness,
      sampled accuracy — as four separate figures.
- [ ] 4.3 Segment slicing plus the uneven-coverage flag.
- [ ] 4.4 Add `packages/db/prisma/schema/data-source-signal.prisma`: `Signal`,
      `SignalSourceBinding`, `SignalStageValue`.
- [ ] 4.5 Migration.
- [ ] 4.6 Signal CRUD; require an outcome definition before any strength value
      is accepted; require a precomputation cadence on search-stage signals.
- [ ] 4.7 Source precedence resolution when several sources produce one signal.
- [ ] 4.8 Declared strength bands, always labeled as estimates.
- [ ] 4.9 Observed likelihood ratio with sample size and a minimum-power
      threshold; leave null when no outcome feed exists rather than
      substituting the declared band.
- [ ] 4.10 ROI scoring per signal per stage; reject cross-stage ranking
      requests outright.
- [ ] 4.11 Weighted source scorecard with editable, versioned weights.
- [ ] 4.12 Stage filter on the comparison surface.
- [ ] 4.13 Signal catalog UI: type, strength (both values), stage, and
      contributing sources.
- [ ] 4.14 Test: four coverage figures reported separately; reachability
      ceiling correct; uneven-coverage flag; outcome-definition gate;
      cross-stage ranking rejected; coverage affects ROI ranking; weight
      version recorded.

## 5. Phase 5 — Demand capture and enforcement

- [ ] 5.1 Add `SearchDemandEvent` model and migration.
- [ ] 5.2 Emit demand events from the search path, marking each filtered
      attribute served or unserved. **Blocked on design.md open question 1** —
      if the search funnel lives outside this repo, build an ingestion
      endpoint instead of in-process emission.
- [ ] 5.3 Unmet demand ranking by volume and distinct requesting organizations.
- [ ] 5.4 Annotate ranked attributes with any registered non-adopted source
      that provides them.
- [ ] 5.5 Unmet demand view in the admin surface.
- [ ] 5.6 Populate license terms for every source in production traffic.
- [ ] 5.7 Review the shadow-mode would-deny log; resolve every case before
      flipping.
- [ ] 5.8 Flip `DataSourceLicenseGuard` to enforcing, including missing-terms
      denial.
- [ ] 5.9 Test: enforcement denies where shadow logged; missing terms deny;
      demand ranking ordering and annotation.

## 6. Cross-cutting

- [ ] 6.1 Every file ≤300 lines; no `as any`; no `@ts-ignore`.
- [ ] 6.2 `bun run typecheck` and `bun run lint` clean.
- [ ] 6.3 `cd apps/api && npx jest src/data-sources` and
      `cd apps/app && npx vitest run` green.
- [ ] 6.4 Run the `audit-design-system` skill over every new frontend file.
- [ ] 6.5 Verify all four breakpoints on the matrix and scorecard — the matrix
      is wide by nature and needs a horizontal scroll container, not a
      squeezed layout.
- [ ] 6.6 Confirm admin audit log entries are produced for every new admin
      endpoint.
- [ ] 6.7 Fold spec deltas into `openspec/specs/` and move this change to
      `openspec/changes/archive/`.
