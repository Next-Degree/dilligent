# Project Context

## What this is

A monorepo (bun + turbo) containing a NestJS API, a Next.js app, an employee
portal, and shared packages. The API is the single source of truth for auth,
RBAC, and business logic; frontends call it over HTTP with session cookies.

```
apps/api/          NestJS — auth, RBAC, all business logic
apps/app/          Next.js — main product surface, includes /admin
apps/portal/       Employee portal
packages/db/       Prisma schema (split per model) + client
packages/auth/     RBAC permission definitions — single source of truth
packages/billing/  Stripe SKU definitions
packages/design-system/  Preferred component library
integrations-catalog/    Version-controlled JSON catalog, one file per integration
```

## Conventions that constrain every change

- **Package manager**: bun. Never npm/yarn/pnpm.
- **File size**: max 300 lines. Split into focused modules past that.
- **Types**: strict. No `as any`, no `@ts-ignore`. zod for runtime validation.
- **Prisma IDs**: prefixed CUIDs via
  `@default(dbgenerated("generate_prefixed_cuid('prefix'::text)"))`.
- **Multi-tenancy**: every query scoped by `organizationId`.
- **API endpoints**: `@Controller({ path: 'name', version: '1' })` plus
  `@UseGuards(HybridAuthGuard, PermissionGuard)` and `@RequirePermission`.
- **Platform-admin endpoints**: `@UseGuards(PlatformAdminGuard)` +
  `@UseInterceptors(AdminAuditLogInterceptor)` + `@ApiExcludeController()`.
- **Frontend data**: `serverApi` server-side, `apiClient`/SWR client-side. No
  new server actions.
- **UI**: `@trycompai/design-system` over the legacy `@trycompai/ui`; Carbon
  icons from `@trycompai/design-system/icons`, never `lucide-react`.
- **Responsive**: 375 / 768 / 1280 / 1920 by default, not on request.
- **Tests**: required with every feature. Vitest in `apps/app`, Jest in
  `apps/api`. Permission tests cover admin and read-only scenarios.

## Existing surfaces relevant to data sourcing

- **`integrations-catalog/`** — 583 checked-in JSON definitions, one per
  external system, each with slug, category, auth config, capabilities, and
  the checks it powers. Reviewed by PR. Precedent for version-controlled
  source metadata.
- **`apps/app/src/app/(app)/admin/integrations`** — platform-admin page for
  configuring OAuth credentials per integration. Shows name, category, auth
  type, configured state. Carries no cost, freshness, coverage, or signal
  metadata.
- **`apps/app/src/app/(app)/[orgId]/admin/*`** — platform-admin console:
  organizations, feature flags, timeline and finding templates.
- **`apps/api/src/background-checks/`** — a real paid per-record external data
  source: priced per check, delivered by webhook, with `lastSyncedAt` and
  `reportSyncedAt` staleness markers and a stored `reportSnapshot`.
- **`packages/billing/src/sku-definitions.ts`** — established shape for
  priced units: integer `unitAmount` in cents, `currency`, `cadence`,
  `includedUsage`.
- **PostHog** is already wired server-side
  (`apps/api/src/admin-feature-flags/posthog.service.ts`).

## Terminology

- **Source** — an external system we buy or pull data from.
- **Field** — a raw datum a source returns (title, employer, email, record date).
- **Signal** — a derived, decision-relevant assertion computed from one or more
  fields, possibly across several sources.
- **Subject** — the entity a source describes (a person, a company).
- **Stage** — where in the funnel a signal is consumed: broad `search`, or
  per-subject work after a subject is on a shortlist (`prospect`).
