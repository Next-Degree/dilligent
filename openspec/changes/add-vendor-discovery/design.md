# Design — Vendor Discovery from Google Workspace

## Context

Five properties of the existing codebase constrain this design. Each was verified against
source, and each rules out an approach that would otherwise look obvious.

| # | Constraint | Evidence |
|---|---|---|
| 1 | At most **one check per manifest per task template** is discoverable | `check-results.service.ts:84-92` uses `.find()`, not `.filter()` |
| 2 | The on-connect run path writes `checkId: 'all'`, and the results reader filters on exact `checkId` | `run-connection-checks.ts:194` vs `check-run.repository.ts:349-382` |
| 3 | Static manifests **cannot** produce `inconclusive` runs | `task-check-evaluation.ts:60-67` returns `isDynamic ? 'inconclusive' : 'failed'` |
| 4 | Vendor risk assessment is **globally serialized**, up to 30 min/run | `vendor-risk-assessment-task.ts:358` — `concurrencyLimit: 1`, Firecrawl key is per-deployment |
| 5 | Check runs and results are **never pruned** | No `deleteMany`/retention in `check-run.repository.ts` or any trigger task; the `CheckResultsService` read path is explicitly uncapped |

## Decisions

### One result row per app, not per (user × app)

**Decision:** emit one `oauth_app` row per OAuth client, with the grantee list inside `evidence`.

Given constraint 5, a 500-person org averaging 20 apps would write ~10,000 rows per daily run,
forever, and the materializer would load all of them uncapped on every pass. Per-app is
~20–200 rows.

This breaks the repo convention of "one row per person, `resourceId` = lowercased email". That
convention exists so features can join per-person against check rows — and nothing will:
`VendorAccessGrant` is the per-person join target. `people-access.service.ts` is unaffected
because it only reads checks bound to `employeeAccess` and filters `resourceType === 'user'`;
this check binds to nothing and emits no `user` rows.

Rejected: emitting both shapes. It creates a second uncapped copy of the same truth that no
reader consumes.

**Size control.** Grantee lists spill into `${clientId}#2`, `#3` … past 500 grantees (ceiling 20
rows/app, then `complete: false`) — never silent truncation. Scopes are stored once in a
`scopeCatalog` with per-user integer indices, since scope strings are ~60 chars and near
identical across grantees; this keeps a 500-grantee row at roughly 40–60KB rather than 300KB+.

### Dedicated schedule, not a `taskMapping`

**Decision:** a dedicated `0 8 * * *` cron, and the check declares no `taskMapping`.

Constraint 1 makes binding to `TASK_TEMPLATES.employeeAccess` unsafe — it would shadow the
existing access check and silently break the People page. There is also no SaaS-inventory task
template (that file is generated from framework seed data), the task-bound path only fires for
orgs that adopted the framework task and left it non-`MANUAL`, and constraint 2 means we must
own run persistence regardless.

Runs at 08:00, after checks (06:00) and employee sync (07:00), so Members exist before grants
are matched to them. Also fires on connect, since the on-connect run's `checkId: 'all'` is
invisible to the results reader.

### Missing scope is handled by recording no run at all

**Decision:** the scheduler preflights scope status and, when consent is missing, creates **no**
`IntegrationCheckRun` — recording the block on `connection.metadata` instead.

Rejected alternatives:

- **Extend `decideRunStatus`** — it governs every static provider (AWS, GCP, Azure). Too much
  blast radius for one provider's consent problem.
- **Record `inconclusive`** — unreachable for static manifests (constraint 3), and
  `inconclusive` runs feed the self-heal agent's queue, where a customer consent issue does not
  belong.
- **Record `failed` with zero rows** — actively dangerous. The results reader excludes only
  `inconclusive`, so a failed-empty run becomes the latest *real* run and returns `[]`, which
  naive reconciliation would read as "every grant was revoked."

Recording nothing leaves yesterday's good run as the latest, so the materializer is never
invoked with a misleading empty set.

For paths we do not own (a user clicking "Run check" in the UI), the check defends itself: it
emits a scope-consent marker row and a `complete: false` run marker, then **returns normally
rather than throwing**. The run records `failed`, which is honest for the integrations UI, and
the trust predicate below refuses to reconcile.

### The trust predicate

Reconciling revocations means writing `revokedAt` based on *absence*. Absence is only meaningful
if the run that produced it was complete, so every run emits a marker row and reconciliation is
gated on it:

```
rows.length === 0                        → do nothing
marker = rows.find(r => r.resourceType === 'inventory')

trustworthy = marker != null
  && marker.evidence.schemaVersion === 1
  && marker.evidence.complete === true
  && marker.evidence.usersInspected > 0
  && (now - marker.collectedAt) <= 48h
  && !rows.some(r => r.resourceId === 'google-workspace:scope-consent')
```

Not trustworthy → **upsert-only**: refresh what was seen, create what is new, skip every
revocation branch. "Zero app rows" is never on its own read as "everything revoked"; a
`complete: true` marker with `appCount: 0` is the only path to reconciling an empty inventory,
which is correct — it genuinely means nobody has authorized anything.

### Grant identity is `(org, member, source, externalAppId)`

**Decision:** not `(member, vendorId)`.

A grant is observed before any vendor exists. Keying on the external app id means approval is a
single `updateMany({ where: { candidateId }, data: { vendorId } })` with no key churn. The grant
points at the candidate **always** and the vendor **once approved** — the candidate is the
observational identity, the vendor is the business object, and dropping either link loses
information.

`externalAppId` is non-null (manual grants use `'manual:<vendorId>'`) because Postgres treats
NULLs as distinct, which would silently defeat the unique constraint.

`candidateId` uses `onDelete: SetNull`, never Cascade — deleting a candidate must not erase the
history of who had access.

### Resolution: deterministic first, AI last, Firecrawl never inline

Precedence, all **exact-on-normalized** (no fuzzy matching, which would create false vendor
links that are worse than none):

1. **The org's existing `Vendor`** — name or domain equality. On hit, link and auto-approve. No
   new vendor. This is the anti-duplicate guarantee.
2. **`GlobalVendors`** — reuses `VendorsService.searchGlobal`, re-ranked in memory to exact
   matches only. Yields the canonical `website` (its primary key).
3. **`DynamicIntegration`** — 583 active rows, memoized with a 1h TTL, giving a name → domain
   map. Note `integrations-catalog/` is a *published export* of this table, not an importable
   package, so the DB is the source.
4. **AI fallback** — batched 25 names per call, only for tier 1–3 misses, once per candidate,
   confidence capped at 0.7. **Never auto-approves.**

Firecrawl is deliberately absent from resolution (constraint 4). Deep research already happens
on approval, because `VendorsService.create` triggers `vendor-risk-assessment-task`.

Anonymous apps (no display name) are never sent to AI — there is nothing to resolve. Google's
own first-party clients are auto-ignored with a recorded reason, or the queue is ~40% noise.

### `Vendor.description` is non-null

A discovered vendor must never be created with `''`. Fallback chain:
`GlobalVendors.company_description` → `DynamicIntegration.description` → AI description →
deterministic `"Discovered via Google Workspace sign-in on <date>. <n> employee(s) have granted
access."`

### Observed state and attested action stay separate

`VendorAccessGrant` is what the system observed. `OffboardingAccessRevocation` is what a human
attested to, and it carries evidence attachments and an actor. Revoking writes both in one
transaction, but the tables are not merged — an auditor needs to distinguish "we saw this
disappear" from "a named person confirmed they removed it."

A grant revoked with reason `offboarding` that reappears **stays revoked** and is flagged. That
is a finding, not a data refresh.

## Risks / Trade-offs

- **Quota and duration.** One API call per user. 5,000 users at concurrency 5 is roughly 2–4
  minutes, but a throttled tenant with `Retry-After` backoff can exceed the usual 15-minute
  budget — hence a 30-minute cap, a 3,000-user ceiling that degrades to `complete: false`, and
  an early exit after 5 consecutive denials (turning a 5,000-call quota burn into 5 calls).
- **Privacy.** A per-employee list of every app someone signed into with a work account,
  including things they consider personal. Mitigated by the existing OU/email filters, RBAC, a
  durable ignore flow, and storing no personal data beyond email and Google user id. Auditors
  hold `vendor:read`; whether grantee lists should additionally require `member:read` is an open
  product question.
- **No recency signal.** The Tokens API returns no last-used timestamp. The UI must say "has
  authorized", never "recently used".
- **Member matching.** Email-only matching breaks on aliases and `+`-addressing. Matching Google
  `userKey` against `Member.externalUserId` first resolves most of it; unmatched grantees are
  counted and reported rather than dropped.

## Open Questions

- Should grantee lists be gated behind `member:read` in addition to `vendor:read`, to keep
  auditor-only roles from seeing per-person app usage?
- What retention applies to revoked grants? They are audit history, but they are also personal
  data.
