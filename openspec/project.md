# Project Context

## Purpose

Comp AI — a compliance and security platform. This `openspec/` directory holds
specification-driven change proposals: what a capability must do, expressed as testable
requirements, agreed before implementation starts.

- `specs/` — current deployed truth, one directory per capability.
- `changes/<change-id>/` — proposed deltas not yet deployed. Merged into `specs/` on ship.

## Tech Stack

- **Monorepo**: bun workspaces + turbo. Never npm/yarn/pnpm.
- **API**: NestJS (`apps/api`) — auth, RBAC, business logic. Single source of truth for auth.
- **Frontend**: Next.js (`apps/app`), employee portal (`apps/portal`).
- **DB**: Prisma (`packages/db`), Postgres, prefixed CUIDs, multi-tenant by `organizationId`.
- **Background jobs**: Trigger.dev (`apps/api/src/trigger/`).
- **Integrations**: `packages/integration-platform` — code manifests + DB-backed dynamic ones.
- **Design system**: `@trycompai/design-system` (`@trycompai/ui` is legacy, being phased out).

## Project Conventions

- Max 300 lines per file. No `as any`, no `@ts-ignore`. Zod for runtime validation.
- Every customer-facing endpoint: `@UseGuards(HybridAuthGuard, PermissionGuard)` +
  `@RequirePermission(resource, action)`, `@Controller({ path, version: '1' })`.
- RBAC is a flat `resource:action` model; single source of truth is
  `packages/auth/src/permissions.ts`.
- Every feature ships with tests. API = Jest, app = Vitest.
- Conventional commits. Never `git stash`, never `--no-verify`, never force-push main.

## Domain Context

Products (compliance, pen testing) are org-level subscription flags, not RBAC. RBAC governs
user access *within* a product. Integration "checks" produce per-resource evidence rows that
features consume read-only via `CheckResultsService` — features must never query
`IntegrationCheckResult` directly.

## Important Constraints

- Vendor risk assessment is **globally serialized** (`concurrencyLimit: 1`) because the
  Firecrawl API key is per-deployment. Anything that enqueues vendor research at volume
  affects every tenant.
- Integration check runs and results are **never pruned**. Row cardinality per run is a
  durable cost, not a transient one.
