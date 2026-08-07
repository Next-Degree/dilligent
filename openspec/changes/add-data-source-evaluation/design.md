# Design: Data Source Evaluation

## Core decision: declared vs observed

Every evaluative dimension is stored twice.

| Dimension | Declared (contract/docs, edited by PR) | Observed (computed from telemetry) |
|---|---|---|
| Cost | list price, unit, tier bundles, minimums | cost per call, per match, per useful signal |
| Freshness | vendor's stated update cadence, per-field TTL | p50/p95 age at read; % served stale |
| Coverage | vendor's stated population | match rate + field completeness on our cohort, by segment |
| Signal strength | prior estimate from the vendor or literature | measured likelihood ratio against outcomes |
| Complexity | pre-integration estimate | actual integration effort + incident rate |

Declared values are cheap and available on day one. Observed values are the
reason to build this rather than keep a spreadsheet. The comparison surface
always shows both and highlights the delta; a large gap is itself the finding.

## Data model

Five model groups, each in its own Prisma schema file under
`packages/db/prisma/schema/`, all using prefixed CUIDs.

### 1. Source (`data-source.prisma`)

`DataSource` — `slug` (stable, matches the catalog filename), `name`,
`vendor`, `category`, `subjectType` (`person` | `company` | `other`),
`lifecycleStatus` (`evaluating` | `trial` | `adopted` | `hold` | `retired`),
`ownerMemberId`, `nextReviewAt`, `declaredMetadata` (Json, catalog-seeded).

`DataSourceField` — one row per raw field the source returns: `path`,
`dataType`, `nullableRate`, `freshnessTtlDays`, `decayProfile`
(`static` | `slow` | `fast` | `append_only`), `piiClass`. This table is what
lets freshness be per-field rather than per-source, which matters: an email
decays slowly, a job title decays fast, a court record never decays but gains
new entries.

`DataSourceCostModel` — `pricingModel` (`per_record` | `per_call` |
`per_refresh` | `subscription` | `credit_bundle`), `unitAmountCents`,
`currency`, `cadence`, `includedUsage` (Json), `minimumCommitCents`,
`refreshIntervalDays`. Field names and integer-cents convention deliberately
mirror `packages/billing/src/sku-definitions.ts` so the two are readable
together.

`DataSourceComplexity` — scored 1–5 on `authOnboarding`, `throughputLimits`,
`schemaVolatility`, `backfillBurden`, `entityResolutionDifficulty`,
`opsModel` (webhook vs poll), plus a derived `effortBand` (S/M/L/XL) and a
`confidence`. Stored rather than computed on read because the estimate is a
judgement someone made on a date and should be auditable.

### 2. Signals (`data-source-signal.prisma`)

`Signal` — `slug`, `name`, `signalType`, `description`, `outcomeDefinition`
(what "good" means for this signal — required, because strength is meaningless
without it).

`SignalType` enum: `strong_positive`, `strong_negative`, `indirect_filter`,
`context_only`.

`SignalSourceBinding` — many-to-many between `Signal` and `DataSource`, with
the `DataSourceField`s consumed, a `coverageContribution`, and a `precedence`
so we know which source wins when several can produce the same signal.

`SignalStageValue` — one row per (signal, stage). `stage` is
`search` | `prospect`. Holds `declaredStrengthBand` (1–5),
`observedLikelihoodRatio`, `sampleSize`, `costPerEvaluationCents`, and a
derived `roiScore`. Splitting by stage is not cosmetic — see below.

### 3. Governance (`data-source-governance.prisma`)

`DataSourceLicense` — `licensedUseScope`, `crossTenantReuse`
(`prohibited` | `derived_only` | `aggregate_only` | `permitted`),
`derivedDataRights`, `retentionMaxDays`, `deletionPropagation`
(`none` | `on_request` | `automatic`), `attributionRequired`,
`jurisdictions` (string[]), `adjudicativeUseAllowed`, `contractUrl`,
`reviewedByMemberId`, `reviewedAt`.

`adjudicativeUseAllowed` is separate from `licensedUseScope` on purpose: using
a source to make an adverse decision about a person pulls in a much heavier
regulatory regime than using the same source to rank a list. The existing
background-check flow already sits on the heavy side of that line, so the
distinction has to be machine-readable, not prose.

### 4. Telemetry (`data-source-provenance.prisma`)

`FieldProvenance` — the load-bearing table. One row per stored field value:
`subjectType`, `subjectId`, `fieldPath`, `dataSourceId`, `fetchedAt`,
`costCents`, `licenseSnapshotId`, `confidence`, `organizationId`.

Field-level, not record-level. Record-level provenance cannot answer "this
person's employer came from source A but their email came from source B, and
A's contract forbids cross-tenant reuse while B's permits it" — which is
exactly the question that decides whether a value may be served.

`licenseSnapshotId` pins the terms *in force at fetch time*. Contracts get
renegotiated; data fetched under old terms stays governed by old terms.

`DataSourceUsageEvent` — per call: `dataSourceId`, `outcome`
(`match` | `miss` | `error` | `rate_limited`), `latencyMs`, `costCents`,
`stage`, `organizationId`. Feeds observed cost and observed match rate.

`SearchDemandEvent` — per customer query: the attributes filtered on, whether
each was `served` or `unserved`, and result count. This is the highest-value
instrument here: it converts "which source should we buy next" from advocacy
into a ranked list of attributes customers ask for and we cannot answer.

### 5. Rollups

`DataSourceMetricRollup` — materialized daily per (source, stage, segment):
observed cost per match, match rate, field completeness, freshness p50/p95,
error rate. Recomputed by a scheduled job rather than aggregated on read; the
comparison page must stay fast with a year of events behind it.

## Why stage is a hard boundary, not a label

`search` and `prospect` differ in what is *technically possible*, not just in
convenience:

- **Search-stage** signals must be evaluable across the whole population
  before anyone asks. That means precomputed and indexed, which means the
  source must be bulk-licensed and cheap per record, and its freshness is
  bounded by the reindex cadence.
- **Prospect-stage** signals are evaluated per subject, on demand, after a
  human has already expressed interest. They can be expensive, slow, and
  per-record priced, and they are fresh at the moment of use.

A source that is excellent at prospect stage can be unusable at search stage
at any price, because per-call pricing over the whole population is not a
budget question but an architecture one. Modelling stage as a property of the
*signal-source pairing* rather than of the source keeps that honest, and makes
the ROI numbers comparable only within a stage — which is the only place the
comparison is meaningful.

## Coverage is four numbers, not one

Reporting a single coverage percentage hides the failure mode we care about.
Coverage decomposes into:

1. **Reachability** — do we hold an identifier this source can be queried by?
2. **Match rate** — given a query, does the source return a subject?
3. **Completeness** — of the fields we actually consume, what share are
   non-null on a match?
4. **Accuracy** — on a spot-checked sample, what share are correct?

All four are computed against a **reference cohort**: a maintained, labeled
sample of subjects that mirrors the real population. Without a fixed cohort,
coverage numbers move whenever the customer mix moves and cannot be compared
across sources or across time.

Every coverage figure is sliced by segment (geography, seniority, industry,
company size). "Not everyone has a profile on the major professional network"
is not a footnote about a single average — it is a statement that coverage is
bimodal across segments, and an average would conceal it.

## Governance enforcement

The cross-tenant reuse rule is enforced in a `DataSourceLicenseGuard` on the
read path, evaluating the `licenseSnapshotId` on each `FieldProvenance` row
against the requesting `organizationId`.

Rollout is two-phase and deliberately ordered:

1. **Shadow** — the guard evaluates and logs decisions but denies nothing.
   Run until the catalog covers every source in production traffic and the
   would-deny rate is understood.
2. **Enforcing** — the guard denies, and a *missing* catalog entry denies
   rather than allows.

Shipping straight to enforcing would break reads on day one; shipping
default-open permanently would mean a source added without a license entry
silently leaks purchased data across tenants. The phase order is the whole
point, and phase 2 is a task in this change, not a follow-up.

## Entity resolution

Coverage and provenance are both unmeasurable without a canonical subject.
Sources key on different identifiers and none of them is universal.

This change assumes a `SubjectIdentity` with per-source identifier mappings
and a resolution confidence. It deliberately does **not** design the
resolution algorithm — that is its own change. What it does require is that
`FieldProvenance` and `DataSourceUsageEvent` reference a canonical subject id,
so that when real resolution lands, the historical telemetry is already
keyed correctly. Until then a degenerate one-to-one mapping is sufficient.

This is the sequencing risk in the plan: weak entity resolution caps the
accuracy of every observed number. Reported metrics therefore carry a
`resolutionConfidence` band, so a coverage figure computed over shakily
resolved subjects is visibly less trustworthy rather than falsely precise.

## Seeding from a checked-in catalog

Declared metadata lives in `data-sources-catalog/<slug>.json`, one file per
source, following the `integrations-catalog/` precedent: reviewed by PR,
diffable, and readable without database access. A seed command upserts it into
the registry by `slug`.

Observed metadata never round-trips into the catalog. The catalog is what we
were *told*; the database is what we *found*. Letting measurements write back
would destroy the comparison the whole design rests on.

## Scoring

`roiScore` per (signal, stage) = `observedLikelihoodRatio` × `coverage` ÷
`costPerEvaluationCents`, normalized within stage. Weights for the source-level
scorecard are stored, editable by platform admins, and versioned — when a
ranking changes, we need to know whether the source changed or the weights did.

Scores are advisory. The `lifecycleStatus` transition is a human action that
records who decided, when, and why, with a `nextReviewAt` that surfaces the
source again. An evaluation artifact that is never revisited is the failure
mode we are replacing.

## Open questions

1. **Does a search/prospect funnel exist outside this repo?** No candidate
   search or prospect list exists here today. If one exists in another system,
   `SearchDemandEvent` needs an ingestion path from it rather than in-process
   emission, and `stage` values should be reconciled with that system's
   vocabulary before the enum is frozen.
2. **Reference cohort ownership.** Who curates it, how large, refreshed how
   often? Coverage numbers are only as good as this cohort, and it needs a
   named owner before phase 3.
3. **Outcome labels for signal strength.** Measured likelihood ratios need
   ground-truth outcomes. Until an outcome feed exists, `observedLikelihoodRatio`
   stays null and the UI shows the declared band only — clearly marked as an
   estimate, never rendered as if measured.
4. **Should governance be org-configurable?** Currently modeled as a platform
   property of the source. If a tenant negotiates its own terms with a vendor,
   the license needs an optional org scope.
