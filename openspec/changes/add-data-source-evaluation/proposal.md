# Add Data Source Evaluation

## Why

We buy data from external sources and we cannot currently answer basic
questions about any of them:

- What does this source cost us per *useful* record — not per call?
- How stale is what it returned, and which fields have already decayed?
- What fraction of the subjects we actually care about does it cover, and
  which segments does it miss?
- Which signals does it produce, how predictive is each one, and is the
  signal a reason to advance a subject, disqualify one, or merely narrow a list?
- Is a signal worth paying for during broad search, only once a subject is on
  a shortlist, or both?
- Are we contractually allowed to reuse a record one tenant paid for?

Today this knowledge lives in people's heads and in ad-hoc spreadsheets. The
closest thing we have in product is the platform-admin integrations page
(`apps/app/src/app/(app)/admin/integrations`), which lists sources with a
category, an auth type, and whether credentials are configured. It has no
concept of cost, freshness, coverage, or signal value, and it is organized
around *credentials*, not around *what the source is worth*. The
`integrations-catalog/` JSON files are closer in spirit — versioned, reviewed,
one file per source — but they describe capabilities and checks, not economics
or evidential value.

Two consequences we are living with now:

1. **Source selection is opinion-driven.** We add sources because someone
   advocates for them, not because we measured demand or value. We have no
   ranked list of what to buy next.
2. **Compliance risk is undocumented and unenforced.** Cross-tenant reuse of
   purchased records is a contract question with a different answer per
   vendor, and nothing in the codebase encodes or enforces that answer.

A spreadsheet cannot fix this. Half of what we need — effective cost, observed
freshness, real coverage against our own population — is only knowable from
production telemetry, and the contract rules need to be enforced at runtime,
not documented in a wiki.

## What Changes

Introduce a **data source registry** with a companion **signal catalog**,
governance metadata, telemetry, and a comparison surface that replaces the
ad-hoc admin views.

The organizing idea is that **every dimension has two values**: what we
*declare* (from the contract and the vendor's docs) and what we *observe*
(measured from real usage). Declared cost is $0.40/record; observed cost per
matched record is $0.94 because 57% of lookups miss. Declared coverage is
"most professionals"; observed match rate on our own subjects is 61%, and 34%
below a certain seniority. The registry stores both, side by side, and the
comparison view shows the gap. That gap is the product.

Concretely:

- **`data-source-registry`** — a source is a first-class entity with a cost
  model, per-field freshness policy, coverage definition, available fields,
  technical-complexity assessment, and a lifecycle decision (evaluate / trial /
  adopted / hold / retired) carrying an owner and a review date. Seeded from
  version-controlled JSON, mirroring the `integrations-catalog/` pattern, so
  changes to a source's declared terms arrive by PR.
- **`data-source-signals`** — signals are modeled separately from sources,
  because one source yields many signals and one signal is often assembled
  from several sources. Each signal declares its type (strong positive, strong
  negative, indirect filter, context only), its strength as a likelihood ratio
  with a displayed 1–5 band, and the stage(s) at which it pays for itself.
- **`data-source-governance`** — per-source licensed use scope, cross-tenant
  reuse rule, derived-data rights, retention ceiling, deletion propagation,
  and jurisdictional restrictions. The cross-tenant reuse rule is enforced by
  a guard on read, not merely recorded.
- **`data-source-telemetry`** — every stored value carries field-level
  provenance (which source, when fetched, at what cost, under which license
  terms, with what confidence). From that we compute observed cost, observed
  freshness distributions, and observed coverage. Also captures **search
  demand**: which attributes customers filter on, and which of those filters
  we cannot serve — the ranked shopping list for what to buy next.
- **`data-source-comparison`** — the platform-admin surface: a source-by-
  dimension matrix, a per-source scorecard with declared-vs-observed deltas, a
  signal view sliced by stage, and an unmet-demand ranking. Weights are
  editable so the team can argue about priorities in the tool rather than in a
  spreadsheet.

### Explicitly out of scope

- Changing how any existing source is *queried*. This change describes and
  measures sources; it does not rewrite ingestion.
- Automatic buy/drop decisions. The system ranks and surfaces; humans decide
  and record the decision.
- Customer-facing exposure. Everything here is platform-admin only in this
  change.
- Backfilling provenance onto data already stored without it. Records
  predating provenance are reported as `provenance: unknown` rather than
  guessed at.

## Impact

**New capabilities:** `data-source-registry`, `data-source-signals`,
`data-source-governance`, `data-source-telemetry`, `data-source-comparison`.

**Code:**

- `packages/db/prisma/schema/` — new schema files for source, signal,
  governance, provenance, and demand models.
- `packages/auth/src/permissions.ts` — new `dataSource` permission resource.
- `apps/api/src/data-sources/` — new NestJS module (registry, signals,
  governance guard, telemetry rollups, comparison read models).
- `apps/app/src/app/(app)/[orgId]/admin/data-sources/` — new admin surface;
  the existing admin integrations page gains a link to a source's evaluation
  record rather than being rewritten.
- `data-sources-catalog/` — new checked-in JSON catalog, one file per source.

**Behavioral risk:** the governance guard is a new denial path on record
reads. It ships default-open with decisions logged, then flips to
default-closed once the catalog is populated, so a missing catalog entry can
never silently expose purchased data.

**Assumption to confirm:** the request that prompted this describes subjects
moving from broad *search* into a *prospect list*, and asks about coverage
gaps like "not everyone has a LinkedIn profile". No candidate-search or
prospect-list domain exists in this repo today — the nearest thing is the
background-check flow over `Member` records. This change therefore models
`stage` and `coverage population` as configurable enums rather than hardcoding
a funnel that isn't built yet, so it stays correct whether the funnel arrives
later or already exists in a system outside this repo. See `design.md`,
"Open questions".
