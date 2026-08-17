# Linear Integration — Implementation Plan

**Status:** Implemented **as a code manifest**, not as a dynamic integration — see
`packages/integration-platform/src/manifests/linear/`. §2 of this plan recommended the dynamic path
and that recommendation was reversed after review; §13 records why. Read §13 before §2.
Outstanding: verify the GraphQL field set against a live Linear workspace (§9 risk 1).

**Slug:** `linear`
**Goal:** Get the `linear` integration in the public catalog manifest actually working end-to-end
on dilligent: connect → store API key → run `linear_employee_access` → results visible on the
integration page and reusable via `CheckResultsService`.

---

## 1. Where we actually stand

The integration platform itself is complete. What is missing is **the implementation half of every
non-code integration** — and Linear is one of them.

| Layer                                                                                            | State                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Registry, DSL interpreter, check runner, credential vault, connection lifecycle, scheduling      | ✅ built (`packages/integration-platform`, `apps/api/src/integration-platform`) |
| Code manifests (AWS, Azure, GCP, GitHub, GitHub App, Google Workspace, Rippling, Vercel, Aikido) | ✅ 9 shipped in `registry/index.ts`                                             |
| **Dynamic (DB-backed) integrations — all 574 of them, incl. Linear**                             | ❌ **zero present in this repo**                                                |
| `integrations-catalog/integrations/linear.json`                                                  | ⚠️ metadata only                                                                |

`integrations-catalog/` is **generated output**, not source. `tools/integrations-catalog-sync/sync.mjs`
pulls from the upstream production API and explicitly _strips_ "check DSL, sync definition, internal
IDs, logo URLs" (see its README). So the catalog tells us the _contract_ — one check called
`linear_employee_access`, custom auth with one API-key field — and nothing about how to satisfy it.

There is also **no source-of-truth directory in the repo for dynamic definitions**. Anything we build
today has to establish that convention. That is part of this plan.

---

## 2. Two ways to implement, and which to pick

### Option A — Dynamic integration (DB row + DSL JSON) ✅ recommended

A `DynamicIntegration` + `DynamicCheck` row pair (`packages/db/prisma/schema/dynamic-integration.prisma`).
`DynamicManifestLoaderService` reads active rows every 60s, converts each check through
`interpretDeclarativeCheck()`, and merges the result into the same registry singleton the code
manifests live in (`registry.refreshDynamic`). From that point Linear is indistinguishable from AWS
to every consumer.

- Matches how the 574 catalog integrations are meant to work — solving Linear solves the pattern.
- No deploy needed to ship or fix a check; versioned + rollbackable via `DynamicCheckVersion`.
- Validated by `validateIntegrationDefinition()` before it can be written.

### Option B — Code manifest (`manifests/linear/`)

What `packages/docs/integrations/writing-integrations.mdx` describes. Full TypeScript, typed
responses, unit-testable in the package, runs everywhere.

- Requires a deploy for every change.
- Code manifests **always win over dynamic ones of the same slug** (`registry.registerDynamic` short-circuits
  on `codeManifestIds`), so shipping `manifests/linear/` permanently blocks the dynamic path for this
  slug. Doing it "just to get started" is a one-way door.

**Recommendation: Option A.** Linear is the stated test case for the dynamic platform; building it as
code proves nothing about the platform and closes the door. The one genuine reason to switch to B is
if Linear needs logic the DSL can't express — it doesn't (see §4).

### ⚠️ Runtime consequence of Option A — read this

`apps/api/src/trigger/integration-platform/dynamic-provider.ts` documents the constraint: the
Trigger.dev runtime seeds its registry with **code manifests only**; `DynamicManifestLoaderService` is a
NestJS lifecycle service that never boots there. So dynamic checks are delegated to the API server via
`shouldRunOnServer()` → `runChecksOnServer` → `POST /v1/integrations/internal/run-connection-checks/:connectionId`.

That path already exists and is tested — Linear needs no new plumbing. But it means:

- Linear check execution consumes API-server request time, not Trigger.dev compute.
- Egress is from our VPC. Linear's API is public, so no allow-listing needed.
- Debug Linear check failures in **API logs**, not the Trigger.dev dashboard.
- Trigger.dev is still the **dispatcher** for auto and scheduled runs even though it isn't the
  executor — see §12 for the full path-by-path breakdown and what the fork has to configure.

---

## 3. Auth: pick `api_key`, not `custom`

The catalog says `"type": "custom"`. That is worth deviating from, and here is why.

`createCheckContext().buildHeaders()` (`runtime/check-context.ts:185`) injects auth automatically for
`oauth2`, `api_key`, and `basic`. **It does nothing for `custom`** — by design, since AWS/Azure/GCP
sign their own requests. If we register Linear as `custom`, every single DSL step must carry
`headers: { "Authorization": "{{credentials.api_key}}" }` by hand, and any step that forgets it fails
with an opaque 400.

Registering as `api_key` instead:

```json
"authConfig": { "type": "api_key", "config": { "in": "header", "name": "Authorization" } }
```

- `buildHeaders` reads `credString('Authorization') || credString('api_key')` → our stored `api_key`
  credential is found and sent as `Authorization: lin_api_...` on **every** request, including
  `ctx.graphql()`. No prefix — Linear personal API keys are sent raw; only OAuth tokens use `Bearer`.
- `ConnectIntegrationDialog.tsx:203` synthesizes an `api_key` password field when `authType === 'api_key'`
  and no `credentialFields` are declared, so the connect form still renders correctly.
- `getProvider` surfaces `setupInstructions` for every non-OAuth auth type
  (`connections.controller.ts:385`), so we keep the catalog's setup copy verbatim.

Net: identical UX, zero per-step auth boilerplate, one less way for a future check to break.
**Trade-off:** `authConfig.type` will differ from the upstream catalog entry. Since the catalog strips
`credentialFields[].id` anyway (our field ids are ours to define), we are already diverging in
substance; this just makes the divergence work in our favour. Flag it in the PR so a future catalog
re-sync doesn't silently overwrite it.

---

## 4. What the check has to do, and how

Linear is **GraphQL-only**: a single `POST https://api.linear.app/graphql`. That shapes the DSL choice.

### Why a `code` step, not `fetch`

The DSL's `fetch` step _can_ POST a `{"query": "..."}` body and pull `data.users.nodes` out with
`dataPath`. Two problems:

1. **GraphQL errors return HTTP 200** with an `errors[]` array. `executeRequest` only throws on
   `!response.ok`, so a permissions error or a bad field name would sail through as a silent empty
   result — the worst possible failure mode for a compliance check.
2. **Cursor pagination doesn't apply.** `fetchPages`/`fetchWithCursor` are GET-only; Linear's
   `pageInfo { hasNextPage endCursor }` needs the cursor threaded into a POST body.

`ctx.graphql()` (`check-context.ts:399`) handles both: it posts to `${baseUrl}/graphql`, inherits
`buildHeaders()`, **throws on `errors[]`**, and throws on a missing `data`. A single `code` step
(`CodeStepSchema`, executed via `AsyncFunction(ctx, scope)` in `interpreter.ts`) gives us a loop plus
`ctx.graphql` — first-class and well covered in `dsl/__tests__/interpreter.test.ts`.

### Result shape — match the Google Workspace convention

`manifests/google-workspace/checks/employee-access.ts` is the reference. Copy its contract exactly:

- **One `ctx.pass()` row per person**, `resourceType: 'user'`, `resourceId: <lowercased trimmed email>`.
  This is what lets person-scoped features join results to org members by email through
  `CheckResultsService` (`services/README-check-results.md`, reference consumer
  `two-factor-source.controller.ts`).
- Access is an **inventory, not a violation** — people rows always pass. Findings are reserved for
  actual failures.
- **Never emit zero rows.** If the workspace has no members, emit one org-level `pass` row, otherwise
  the run reads as "no evidence collected".
- `taskMapping: TASK_TEMPLATES.employeeAccess` = `frk_tt_68406ca292d9fffb264991b9`
  (`packages/integration-platform/src/task-mappings.ts:195`), same task Google Workspace auto-completes.

### GraphQL to issue

```graphql
query CompAIEmployeeAccess($after: String) {
  organization {
    id
    name
    urlKey
    userCount
  }
  users(first: 250, after: $after, includeDisabled: true) {
    nodes {
      id
      name
      displayName
      email
      active
      admin
      guest
      createdAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

> **Verify before writing the definition.** `id / name / displayName / email / active / admin / guest /
createdAt` on `User` and `id / name / urlKey` on `Organization` are high-confidence. `userCount`,
> `lastSeen`, and the SAML/SCIM fields floated in §9 are **not verified** against the current schema —
> run the query in Linear's GraphQL explorer first. A wrong field name makes the whole query error,
> and `ctx.graphql` will (correctly) fail the entire run.

---

## 5. Files to add

```
integrations-definitions/                        # NEW — source of truth for dynamic definitions
  README.md                                      #   what this dir is, how to seed, review rules
  linear.json                                    #   full DynamicIntegrationDefinition (manifest + DSL)

packages/integration-platform/src/dsl/__tests__/
  linear-definition.test.ts                      # NEW — schema + behavioural tests (see §7)

docs/plans/2026-08-12-linear-integration.md      # this file
```

Deliberately **not** added:

- No `manifests/linear/` — see §2.
- No `registry/index.ts` edit — dynamic manifests self-register.
- No frontend work. The integrations page renders from `GET /v1/integrations/providers`, the connect
  form from `GET /v1/integrations/providers/linear`, both driven off the manifest. Linear appears the
  moment the row is active.
- No migration. `DynamicIntegration` / `DynamicCheck` already exist.

### Why a new top-level `integrations-definitions/`

The fork has nowhere to keep dynamic definitions, and they cannot live in `integrations-catalog/`
(machine-generated, wiped by `sync.mjs`, and DSL is deliberately excluded from that public artifact).
A sibling directory keeps the parallel obvious: _catalog = public output, definitions = private input._
It also makes the DSL reviewable in PRs, which is the main thing DB-only definitions lose.

### `integrations-definitions/linear.json` (draft)

`logoUrl` is required by `DynamicIntegrationDefinitionSchema` and follows the house pattern
(`https://img.logo.dev/<domain>?token=pk_AZatYxV5QDSfWpRDaBxzRQ`, already used by all 9 code manifests).

```jsonc
{
  "slug": "linear",
  "name": "Linear",
  "description": "Linear project and issue tracking for software teams",
  "category": "Development",
  "logoUrl": "https://img.logo.dev/linear.app?token=pk_AZatYxV5QDSfWpRDaBxzRQ",
  "docsUrl": "https://developers.linear.app/docs",
  "baseUrl": "https://api.linear.app",
  "defaultHeaders": { "Content-Type": "application/json" },
  "authConfig": {
    "type": "api_key",
    "config": {
      "in": "header",
      "name": "Authorization",
      "setupInstructions": "1. Log in to Linear\n2. Go to Settings > Account > Security & Access (or visit https://linear.app/settings/account/security)\n3. Under Personal API keys, click Create key\n4. Paste the key below",
    },
  },
  "capabilities": ["checks"],
  "supportsMultipleConnections": false,
  "checks": [
    {
      "checkSlug": "linear_employee_access",
      "name": "Employee Access",
      "description": "Verifies Linear is connected and lists workspace members",
      "defaultSeverity": "medium",
      "taskMapping": "frk_tt_68406ca292d9fffb264991b9",
      "isEnabled": true,
      "sortOrder": 0,
      "definition": {
        "steps": [
          {
            "type": "code",
            "code": "/* see §6 */",
          },
        ],
      },
    },
  ],
}
```

> `setupInstructions` sits inside `authConfig.config`. `ApiKeyConfigSchema` doesn't declare it, but
> **it survives end-to-end and renders — verified**: `DynamicIntegrationDefinitionSchema` types
> `config` as `z.record(z.string(), z.unknown())` (`dsl/types.ts:389`) so zod preserves the key;
> `convertToManifest` passes `authConfig.config` through untouched
> (`dynamic-manifest-loader.service.ts:139`); `getProvider` reads it via
> `'setupInstructions' in manifest.auth.config` (`connections.controller.ts:382`), true for `api_key`;
> and `ConnectIntegrationDialog.tsx:607` renders it whenever `setupScript` is absent — and `setupScript`
> is only surfaced for `custom` auth, so for `api_key` it is always undefined.
>
> The `credentialFields[0].helpText` fallback floated in an earlier draft would **not** have worked:
> dynamic manifests only synthesize `credentialFields` for `basic` auth
> (`dynamic-manifest-loader.service.ts:160`), and the `api_key` field is synthesized client-side with
> no `helpText`. Good thing it isn't needed.

---

## 6. The check body

```js
const PAGE = 250;
const nodes = [];
let after = null;
let org = null;

for (let page = 0; page < 20; page++) {
  const data = await ctx.graphql(
    `query CompAIEmployeeAccess($after: String) {
       organization { id name urlKey }
       users(first: ${PAGE}, after: $after, includeDisabled: true) {
         nodes { id name displayName email active admin guest createdAt }
         pageInfo { hasNextPage endCursor }
       }
     }`,
    { after },
  );

  org = org ?? data.organization;
  nodes.push(...(data.users?.nodes ?? []));

  if (!data.users?.pageInfo?.hasNextPage) break;
  after = data.users.pageInfo.endCursor;
}

const checkedAt = new Date().toISOString();
const active = nodes.filter((u) => u.active);

ctx.log(`Linear: ${nodes.length} members (${active.length} active) in ${org?.name ?? 'workspace'}`);

// Never store zero rows — an empty run reads as "no evidence".
if (active.length === 0) {
  ctx.pass({
    title: 'Employee Access List',
    resourceType: 'organization',
    resourceId: org?.urlKey ?? 'linear',
    description: `No active members found (${nodes.length} member records inspected)`,
    evidence: { totalUsers: 0, inspectedUsers: nodes.length, checkedAt },
  });
  return;
}

// One row per person — resourceId is the lowercased email so person-scoped
// features can join to org members (same contract as Google Workspace).
for (const u of active) {
  const email = String(u.email ?? '')
    .toLowerCase()
    .trim();
  if (!email) {
    ctx.warn(`Skipping Linear member ${u.id}: no email on record`);
    continue;
  }
  const role = u.admin ? 'Admin' : u.guest ? 'Guest' : 'Member';
  ctx.pass({
    title: 'Employee Access',
    resourceType: 'user',
    resourceId: email,
    description: `${u.name ?? u.displayName ?? email} has access to Linear as ${role}`,
    evidence: {
      email,
      name: u.name ?? u.displayName ?? null,
      role,
      roles: [role],
      isAdmin: Boolean(u.admin),
      isGuest: Boolean(u.guest),
      externalId: u.id,
      workspace: org?.name ?? null,
      createdAt: u.createdAt ?? null,
      checkedAt,
    },
  });
}
```

Notes:

- The 20-page cap (5,000 members) is a runaway guard, mirroring `MAX_PAGES_DEFAULT` in the context. If
  it is ever hit we silently truncate — **add a `ctx.warn` on the final iteration** so a truncated run
  is visible rather than looking complete.
- Auth failures and GraphQL errors throw out of `ctx.graphql`, which fails the run with a real message
  rather than producing an empty pass set.
- Rate limits (429) and 5xx are already retried with backoff by `withRetry`.

---

## 7. Seeding and promotion

Three write paths exist; all funnel through `validateIntegrationDefinition()`:

1. **`bun run apps/api/src/scripts/seed-dynamic-integration.ts integrations-definitions/linear.json`**
   — validates, upserts `DynamicIntegration` + `DynamicCheck` + `IntegrationProvider`, done. Use for
   local dev and as the deploy step.
   > ⚠️ The script upserts `syncDefinition` but **not** `deviceSyncDefinition` or `services`. Irrelevant
   > for Linear (`capabilities: ["checks"]`), but don't reuse it blind for a sync-capable integration.
2. **`PUT /v1/internal/dynamic-integrations`** — same upsert over HTTP, guarded by `InternalTokenGuard`.
   Intended for agents/CI.
3. **`/admin/integrations`** — the existing admin UI is OAuth-credential management only; it has no
   dynamic-definition editor. Not a path today.

Registry pickup is automatic within 60s (`DynamicManifestLoaderService` interval), or immediately on
API restart / `invalidateCache()`.

**Promotion order:** seed locally → verify with a real personal API key → commit the JSON → seed
staging → seed production. The JSON in git is the reviewable artifact; the DB row is the deployed copy.

---

## 8. Testing

> ⚠️ **Sort the runner out first.** `packages/integration-platform/package.json` has **no `test`
> script and no vitest/jest dependency**; its existing DSL tests import from `'bun:test'`
> (`dsl/__tests__/interpreter.test.ts:1`). CLAUDE.md's vitest convention is for `apps/app`, not here.
> So: write the tests with `bun:test`, **and** add a `test` script to the package and wire it into
> turbo — otherwise `turbo run test` skips the package and the new tests never execute in CI. Shipping
> tests no runner invokes is worse than shipping none, because it looks covered.

Repo rule: every new feature ships tests. Definition-level coverage, run from
`packages/integration-platform`:

1. **Schema** — `validateIntegrationDefinition(linearJson).success === true`. Catches a malformed DSL
   before it reaches a DB.
2. **Behaviour** — feed the definition through `interpretDeclarativeCheck()` with a stubbed `ctx`
   (`graphql` returning fixture pages) and assert:
   - two-page fixture → all members collected, cursor threaded correctly;
   - one `pass` per active member, `resourceId` = lowercased email, `resourceType: 'user'`;
   - inactive members excluded;
   - empty workspace → exactly one org-level `pass`, never zero rows;
   - a member with no email is skipped with a warning, not crashed on;
   - `ctx.graphql` rejecting → the run rejects (no silent empty pass set).
3. ~~Round-trip test for `setupInstructions`~~ — dropped. Traced and confirmed working end-to-end
   (§5), so there is nothing uncertain left to pin down.

Manual verification — **no-Trigger loop** (works with nothing deployed):

- `/{orgId}/integrations/platform-test` — the existing harness: connect, run checks, read raw
  findings/passing-results/logs. Fastest feedback loop.
- Confirm the Access Review task (`frk_tt_68406ca...`) picks up the mapping.
- Bad-key path: paste garbage, confirm the run is recorded `failed` with a legible message
  (`checks.controller.ts:370`) rather than passing empty. **This only holds on the manual path** — see
  the next block.

Manual verification — **Trigger-gated** (needs the fork setup in §12):

- Connect from `/{orgId}/integrations` and confirm auto-run actually fires. Without a configured
  Trigger project, `tasks.trigger('run-connection-checks')` throws, is caught, and returns `false`
  (`auto-check-runner.service.ts:126-142`) — the connect **succeeds and nothing runs, with no
  user-visible error**. That silent success is the trap; don't read it as a working integration.
- Scheduled run: confirm the org actually has an instantiated, non-MANUAL Task for
  `frk_tt_68406ca...`, or the daily job skips Linear entirely (§9, risk 7).
- Scheduled bad-key run: confirm you can still _find_ the failure. On the scheduled path it is stored
  `inconclusive` and hidden from the customer, not `failed` (§9, risk 8).

---

## 9. Risks and follow-ups

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Handling                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Unverified GraphQL fields** (`userCount`, `lastSeen`, SAML/SCIM). One bad name errors the whole query.                                                                                                                                                                                                                                                                                                                                                              | Verify in Linear's explorer before writing the JSON. Ship the conservative field set.                                                                                                                                                   |
| 2   | **No connect-time credential validation.** `createConnection` only hard-validates AWS; a bad Linear key creates an "active" connection whose first check fails.                                                                                                                                                                                                                                                                                                       | Accept for v1, but note this is **weaker than it first looks** — it only surfaces promptly on the manual path (risk 8). Follow-up: a generic `viewer { id }` probe for `api_key` providers, which would benefit all 574.                |
| 3   | **Personal API key = one person's permissions**, and it dies when that person is offboarded.                                                                                                                                                                                                                                                                                                                                                                          | Call it out in `setupInstructions`; recommend a service account. Longer term, Linear OAuth.                                                                                                                                             |
| 4   | **`authConfig.type` diverges from the upstream catalog** (`api_key` vs `custom`).                                                                                                                                                                                                                                                                                                                                                                                     | Documented in §3; note in the PR so a catalog re-sync doesn't clobber it.                                                                                                                                                               |
| 5   | **Pagination cap silently truncates** past 5,000 members.                                                                                                                                                                                                                                                                                                                                                                                                             | Add the `ctx.warn` from §6.                                                                                                                                                                                                             |
| 6   | **`code` steps are `AsyncFunction`-evaluated** — a definition is executable code with vault credentials in scope.                                                                                                                                                                                                                                                                                                                                                     | Definitions live in git and go through PR review; the DB write paths are `InternalTokenGuard`-only. Worth an explicit note in `integrations-definitions/README.md`.                                                                     |
| 7   | **Scheduling is gated on task instantiation, not just on the connection.** The daily job reduces checks to `taskTemplateIds` and skips any connection whose checks have no mapping (`run-integration-checks-schedule.ts:208`), then filters to org Tasks that are non-`MANUAL` and due (`:216-234`). An org with no Task for `frk_tt_68406ca...` — framework not enabled, or task set to MANUAL — **never gets a scheduled Linear run**, silently.                    | Not a Linear bug; it's how the scheduler works for every integration. Verify the task exists during rollout (§8) and state the precondition in the runbook.                                                                             |
| 8   | **On the scheduled path a dynamic check can never fail the task, and errors are hidden.** `run-task-integration-checks.ts:458` — `const statusFailures = isDynamic ? [] : failingFindings;` — and `decideRunStatus` (`task-check-evaluation.ts:60-68`) stores _any_ non-success dynamic run as `inconclusive`, hidden from the customer and held pending a self-heal agent. A bad API key, a renamed GraphQL field, and a transport blip all look identical: nothing. | **Know this before rollout.** It means the manual path is the only place a Linear failure is legible, so bad-key and error-path verification must happen there. Don't promise customers that a broken Linear connection self-announces. |
| 9   | Second check candidates (SAML/SCIM enforcement, guest-account review, admin-count threshold)                                                                                                                                                                                                                                                                                                                                                                          | Out of scope — the catalog declares one check. Revisit once field availability is confirmed.                                                                                                                                            |

---

## 10. Task list

| #   | Task                                                                                        | Depends on |
| --- | ------------------------------------------------------------------------------------------- | ---------- |
| 1   | Verify the GraphQL query against a real workspace; lock the field set                       | —          |
| 2   | Create `integrations-definitions/` + README (conventions, seeding, `code`-step review rule) | —          |
| 3   | Write `integrations-definitions/linear.json` (manifest + check DSL)                         | 1, 2       |
| 4   | Add a `test` script (`bun test`) to `packages/integration-platform` and wire it into turbo  | —          |
| 5   | Write `linear-definition.test.ts` with `bun:test` (schema + behaviour)                      | 3, 4       |
| 6   | Seed locally, connect with a real key, verify via `platform-test`                           | 3          |
| 7   | Verify per-user rows are readable through `CheckResultsService` and the task mapping fires  | 6          |
| 8   | `bun run lint`, `typecheck`, and the package's new `test` script                            | 5          |
| 9   | PR: JSON + tests + this plan; note the `api_key`-vs-`custom` divergence                     | 3–8        |
| 10  | Seed staging → production                                                                   | 9          |

Steps 1 and 6 need a real Linear workspace and a personal API key — that is the only external
dependency, and it blocks nothing else in the list.

Steps 1–9 need **no Trigger.dev** _for the manual run path_, which executes in the API process (§12).
Two caveats that earlier drafts of this plan got wrong:

- **Auto-run on connect is not in the no-Trigger loop.** It calls `tasks.trigger(...)`, and with no
  Trigger project the call throws, is swallowed, and returns `false` — connect looks successful and
  nothing runs. Verify it only after the fork setup lands.
- **Fork Trigger setup gates more than step 10.** Until it's done there is no scheduled _or_
  auto-on-connect coverage at all — only the manual button. That is a product gap, not just a
  deployment detail, so decide deliberately whether Linear ships before or after it.

Fork setup itself — own project refs, `TRIGGER_ACCESS_TOKEN`, `SERVICE_TOKEN_TRIGGER`, `BASE_URL` — is
one-time work that unblocks every dynamic integration, not Linear work.

---

## 11. Reconciliation with the published docs

Checked against https://www.trycomp.ai/docs/integrations (`writing-integrations`, `checks`,
`contributing`, `oauth-setup`). Three things a reviewer should know:

**The public docs only describe the code-manifest path.** There is no published page on dynamic
integrations, the DSL, `DynamicIntegration`/`DynamicCheck`, or the seeding endpoints. Everything in
§2–§7 above is read off the source, not the docs. If we land the dynamic path for Linear, the
follow-up is a `dynamic-integrations.mdx` page — otherwise the next person repeats this excavation.

**The docs have drifted from the implementation in at least one place.** The checks page lists
`ctx.fetchWithPageNumbers()`, which does not exist on `CheckContext`; the real helpers are
`fetchAllPages`, `fetchWithCursor`, and `fetchWithLinkHeader` (`runtime/check-context.ts`). Treat the
source as authoritative when the two disagree.

**One apparent conflict worth pre-empting in review.** The checks page says to reserve `ctx.pass()`
for "summary results and audit evidence" and not to "create passing results for every check" — which
reads as an argument against the per-person pass rows in §4/§6. It isn't, for this check:

- An access review _is_ audit evidence — the row set is the deliverable, not a side effect.
- `CheckResultsService` joins per-resource rows by `resourceId`; collapsing to one summary row would
  make the results unusable to any person-scoped feature (`README-check-results.md`, reference
  consumer `two-factor-source.controller.ts`).
- The in-repo precedent is explicit. `manifests/google-workspace/checks/employee-access.ts` emits one
  pass per person and carries a comment saying exactly why: _"Access is an inventory, not a violation
  — every person row emits as pass."_

The docs' guidance is aimed at ordinary pass/fail compliance checks, where a row per resource is
noise. Inventory checks are the documented exception, and Linear is one.

---

## 12. Infrastructure reuse — what Linear rides on, and what the fork must configure

The design goal is that Linear is **data, not code**. Everything below already exists and is
provider-agnostic; Linear contributes one JSON definition and nothing else.

### Reused as-is — zero new code

| Concern                                    | Existing machinery                                                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider listing / connect form            | `GET /v1/integrations/providers[/:slug]` — rendered from the manifest                                                                                                                               |
| Credential entry                           | `ConnectIntegrationDialog` synthesizes the `api_key` field (`:203`)                                                                                                                                 |
| Credential storage                         | `CredentialVaultService.storeApiKeyCredentials` (encrypted)                                                                                                                                         |
| Connection lifecycle                       | `createConnection` → `activateConnection` → pause/resume/disconnect                                                                                                                                 |
| Auth header injection                      | `buildHeaders()` for `api_key` — no per-check auth code                                                                                                                                             |
| HTTP retry / 429 / 5xx / transport backoff | `withRetry` in `check-context.ts`                                                                                                                                                                   |
| GraphQL transport + error surfacing        | `ctx.graphql()`                                                                                                                                                                                     |
| Check execution                            | `runAllChecks` / `interpretDeclarativeCheck`                                                                                                                                                        |
| Result persistence                         | `CheckRunRepository` → `IntegrationCheckResult`                                                                                                                                                     |
| Result reuse by other features             | `CheckResultsService`                                                                                                                                                                               |
| Task auto-completion                       | `taskMapping` → `TASK_TEMPLATES.employeeAccess`                                                                                                                                                     |
| Scheduling                                 | `integrationChecksSchedule` — daily cron, iterates all active connections generically (but see §9 risk 7: it only picks up checks whose `taskMapping` matches an instantiated, non-MANUAL org Task) |
| Manual + auto run                          | `POST /connections/:id/run`, `AutoCheckRunnerService.tryAutoRunChecks`                                                                                                                              |
| Registry merge                             | `DynamicManifestLoaderService`, 60s refresh                                                                                                                                                         |
| Definition write paths                     | `seed-dynamic-integration.ts`, `PUT /v1/internal/dynamic-integrations`                                                                                                                              |

**Do not build:** a `linear` Trigger task, a Linear-specific API route, a bespoke scheduler, a custom
credential form, or a `manifests/linear/` folder. Every one of those already has a generic equivalent.

### The three run paths, and which need Trigger.dev

| Path                                                                     | Dispatcher                                                                                    | Executor                                                                      | Needs Trigger? |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------- |
| Manual "Run checks" (`POST /v1/integrations/checks/connections/:id/run`) | API                                                                                           | **API, in-process** — also persists the run                                   | **No**         |
| Auto-run on connect (`AutoCheckRunnerService`)                           | API → `tasks.trigger('run-connection-checks')`                                                | Trigger → delegates back to API via `runChecksOnServer`; **Trigger persists** | **Yes**        |
| Daily cron, 06:00 UTC                                                    | Trigger: `integrationChecksSchedule` → `runOrgIntegrationChecks` → `runTaskIntegrationChecks` | same delegation back to API; Trigger persists                                 | **Yes**        |

Note the daily chain does **not** pass through `run-connection-checks` — that task serves auto-run
only. The scheduled path is `run-integration-checks-schedule.ts:288` → `run-org-integration-checks.ts:263`
→ `run-task-integration-checks.ts:244`, which is where `runChecksOnServer` is called and where the
dynamic-specific status handling in §9 risk 8 lives.

One more split worth internalising: on the delegated paths the API **executes but does not persist** —
`ConnectionCheckRunnerService` is explicitly documented as "Does NOT write to the database"
(`connection-check-runner.service.ts:47`). It returns raw results to the Trigger worker, which writes
them. The manual path does both itself. So a Trigger outage doesn't just stop scheduling; it also means
nothing on those paths gets recorded.

Two consequences worth planning around:

1. **You can build and verify Linear end-to-end with no Trigger.dev at all.** The manual endpoint —
   which is what `/{orgId}/integrations/platform-test` calls — decrypts credentials, builds the
   context, and runs the checks inside the API process. That is the whole dev loop for steps 1–6 of §10.
2. **Recurring coverage does need Trigger deployed in this fork.** Without it you get a working
   integration that only runs when someone clicks the button.

### What the fork has to configure (one-time, not per-integration)

This is the "our own trigger uploads" part. It is fork setup, not Linear work, and it unblocks every
dynamic integration at once:

- **Trigger project refs are hardcoded to upstream CompAI projects** — `apps/api/trigger.config.ts:9`
  (`proj_kmfzoqeidtxikiewbwzj`) and `apps/app/trigger.config.ts:8` (`proj_pgcndrsfzokifeycvusi`).
  Both need to point at dilligent's own projects.
- **`TRIGGER_ACCESS_TOKEN`** repo secret — consumed by the two existing deploy workflows
  (`trigger-api-tasks-deploy-main.yml`, `trigger-tasks-deploy-main.yml`). The workflows themselves
  need no changes; they already build `packages/integration-platform` and the DB package first.
- **`SERVICE_TOKEN_TRIGGER`** in the Trigger environment — `runChecksOnServer` throws without it, so
  every dynamic check dispatched from Trigger fails at the delegation hop.
- **`BASE_URL`** in the Trigger environment — the API base `runChecksOnServer` posts back to
  (`run-connection-checks.ts:120`, defaults to `http://localhost:3333`).

### The redeploy rule

Since dynamic definitions live in the DB and dynamic checks execute on the API server:

- Changing `linear.json` (or any dynamic check) → **re-seed only**. No Trigger deploy, no API deploy.
  Registry picks it up within 60s.
- Changing `packages/integration-platform` itself — the interpreter, `check-context`, the DSL — →
  redeploy both Trigger apps (the package is bundled in via `integrationPlatformExtension()`) **and**
  the API.

That split is the main practical payoff of the dynamic path, and the reason not to spend fork setup
effort on anything Linear-specific.

---

## 13. Decision reversed: code manifest, not dynamic

§2 recommended the dynamic (DB-backed DSL) path. After review that was reversed, and Linear ships as
a code manifest under `packages/integration-platform/src/manifests/linear/`, alongside Vercel, AWS
and Google Workspace. Sections 2–12 are kept as the reasoning trail; where they conflict with this
section, this section wins.

### Why

**The deciding factor is self-hosting.** Dynamic integrations buy the ability to add and fix
integrations without a deploy, across hundreds of vendors. That matters for a multi-tenant SaaS
shipping the full catalog. Here we build only the integrations we actually need, so a clear, typed,
greppable structure is worth more than no-deploy edits.

**It also removes the two worst findings from the audit in §9:**

- **Risk 8 disappears.** `isDynamic = manifest ? false : …` (`run-task-integration-checks.ts:87`), so
  a code manifest gets `isDynamic = false`. `decideRunStatus` returns `failed` rather than
  `inconclusive`, and `statusFailures = failingFindings` rather than `[]`. Failures are visible to the
  customer and can fail the task, instead of being held pending a self-heal agent.
- **The delegation hop disappears.** `shouldRunOnServer` returns false when a manifest exists, so the
  check runs in-process in the Trigger worker. No `runChecksOnServer`, and no dependency on
  `SERVICE_TOKEN_TRIGGER` or `BASE_URL` for the check to execute.

**And two smaller wins:** the check is typed TypeScript that `tsc` verifies, rather than ~100 lines of
JavaScript inside a JSON string; and there is no seeding step, no 60s registry window, and no DB row
to keep in sync across environments — it deploys with the code.

### What §2 got wrong

§2 called the code-manifest path "a one-way door". That was overstated. Code manifests do shadow
dynamic ones permanently _while registered_, but removing the entry from `registry/index.ts` hands the
slug back to a dynamic definition. It is reversible with a deploy.

### What this costs

Every check edit now needs a deploy, and this does not advance the dynamic platform for the other 573
catalog integrations. Both were accepted deliberately. If the dynamic path is ever picked up, the
worked example is in this file's history (`integrations-definitions/linear.json`, removed in the port)
along with the DSL notes in §4 and §6.

### One platform change came with it

`ApiKeyConfigSchema` gained an optional `setupInstructions` field
(`packages/integration-platform/src/types.ts`). `getProvider` already surfaces `setupInstructions` for
every credential-entry auth type — the schema simply had nowhere for an `api_key` manifest to put
them, forcing the guidance into a field's `helpText`. Optional and additive, so no existing manifest
changes; every future `api_key` integration benefits.

### Structure shipped

```
packages/integration-platform/src/manifests/linear/
├── index.ts                          # manifest: api_key auth, credentialFields, setup instructions
├── types.ts                          # LinearUser, LinearOrganization, response shapes
├── checks/
│   ├── index.ts
│   └── employee-access.ts            # ctx.graphql + cursor pagination + friendly error mapping
└── __tests__/
    └── employee-access.test.ts       # 19 tests
```

Registered in `registry/index.ts`. Everything §3 said about auth, §4 about `ctx.graphql` versus a REST
call, and §4 about the per-person result contract still applies — those choices carried over
unchanged, they are just expressed in TypeScript now.
