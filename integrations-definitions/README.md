# Integration Definitions

Source of truth for **dynamic integrations** — the ones whose manifest and check logic live in the
database as JSON rather than as TypeScript in `packages/integration-platform/src/manifests/`.

One file per integration: `<slug>.json`, matching `DynamicIntegrationDefinition`
(`packages/integration-platform/src/dsl/types.ts`).

## Why this directory exists

`integrations-catalog/` is **generated output**, not input. `tools/integrations-catalog-sync/sync.mjs`
pulls public metadata from the API and deliberately strips the check DSL, sync definitions, task
mappings, and credential field ids. Re-running the sync overwrites it. So definitions cannot live
there.

Keeping them here means the DSL is diffable and reviewable in a PR — the main thing a DB-only
definition loses.

| Directory | Direction | Contains |
|---|---|---|
| `integrations-catalog/` | DB → public JSON (generated) | vendor metadata, check names, auth type |
| `integrations-definitions/` | git → DB (authored) | the same plus the actual check DSL |

## Seeding

```bash
bun run apps/api/src/scripts/seed-dynamic-integration.ts integrations-definitions/linear.json
```

The script validates against the Zod schema, then upserts `DynamicIntegration`, its `DynamicCheck`
rows, and the `IntegrationProvider` row. `DynamicManifestLoaderService` merges the result into the
registry within 60s, or immediately on API restart.

The same payload can go through `PUT /v1/internal/dynamic-integrations` (guarded by
`InternalTokenGuard`) for CI or agent-driven updates.

Two things the seed script does **not** carry, despite them being real columns: `deviceSyncDefinition`
and `services` (and per-check `service`). Irrelevant for a `checks`-only integration; don't assume it
covers them if you add a sync-capable one.

## Rules for a definition in this directory

1. **A code manifest of the same slug wins permanently.** `registry.registerDynamic` short-circuits on
   `codeManifestIds`, so never add a definition here for a slug that also exists under
   `manifests/`. Pick one.
2. **`code` steps are executable code.** The DSL's `code` step runs via `AsyncFunction(ctx, scope)`
   with decrypted credentials in scope. Treat a definition like any other privileged source file:
   review it, and never let one reach `main` unread. The DB write paths are internal-token-guarded,
   and this directory is the reviewable copy — that pairing is the whole control.
3. **No secrets.** Definitions are public-ish by construction. Credentials arrive at runtime through
   the vault as `ctx.credentials`.
4. **Prefer declarative steps** (`fetch`, `forEach`, `aggregate`, `branch`) over a `code` step when
   the API allows it. Reach for `code` when the transport genuinely needs it — a GraphQL API whose
   errors come back with HTTP 200, or pagination that has to thread a cursor through a POST body.
   `linear.json` documents that reasoning inline.
5. **Ship tests.** Definitions are data, so a type-checker cannot catch a typo'd field or a broken
   emit. See `packages/integration-platform/src/dsl/__tests__/linear-definition.test.ts` for the
   pattern: validate the JSON against the schema, then drive the check through
   `interpretDeclarativeCheck` with a stubbed `ctx`.

## Auth: prefer a typed auth strategy over `custom`

`buildHeaders()` (`runtime/check-context.ts`) injects auth automatically for `oauth2`, `api_key`, and
`basic`. It does **nothing** for `custom` — by design, since AWS/Azure/GCP sign their own requests. A
`custom` definition therefore has to set an `Authorization` header on every single step by hand, and
any step that forgets one fails with an opaque error.

If the vendor takes a bearer-style key, declare `api_key` and let the platform do it:

```jsonc
"authConfig": {
  "type": "api_key",
  "config": { "in": "header", "name": "Authorization", "setupInstructions": "..." }
}
```

The credential is stored under `api_key`, and `buildHeaders` resolves it via
`credString(config.name) || credString('api_key')`. Add `"prefix": "Bearer "` if the vendor wants one;
Linear does not.

Note this can diverge from the upstream catalog entry, which may list `custom` for the same vendor.
That is fine — the catalog strips credential field ids anyway, so the concrete auth wiring is ours to
define. Flag the divergence in the PR so a future catalog re-sync doesn't silently revert it.

## Running checks locally, without Trigger.dev

Dynamic checks execute in the **API process**, not in the Trigger.dev worker — the Trigger runtime's
registry only holds code manifests (see the comment block in
`apps/api/src/trigger/integration-platform/dynamic-provider.ts`). Trigger dispatches, then calls back
into the API.

So the fastest loop needs no Trigger deployment at all:

1. Seed the definition.
2. Connect the integration in the app.
3. `/{orgId}/integrations/platform-test` — run checks and read raw findings, passing results, and logs.

That path (`POST /v1/integrations/checks/connections/:id/run`) executes and persists entirely in the
API. Auto-run-on-connect and the daily schedule both need Trigger configured; without it,
`tasks.trigger(...)` throws, is swallowed, and the connect *looks* successful while nothing runs.
