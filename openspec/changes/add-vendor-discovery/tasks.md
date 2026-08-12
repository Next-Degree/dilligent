# Implementation Tasks

Sequenced as five shippable increments. Each is independently mergeable; increment 1 is a
zero-behaviour-change migration.

## 1. Schema

- [ ] 1.1 Add `packages/db/prisma/schema/vendor-discovery.prisma` with `DiscoveredVendorCandidate`
      (prefix `dvc`) and `VendorAccessGrant` (prefix `vag`)
- [ ] 1.2 Add enums: `DiscoveredVendorStatus`, `DiscoveredVendorSource`, `VendorResolutionMethod`,
      `VendorAccessGrantSource`, `VendorAccessGrantRevokedReason`, `VendorSource`
- [ ] 1.3 Add `source` (defaulted) and `discoveredAt` (nullable) to `Vendor`; add back-relations
      on `Vendor`, `Member`, `Organization`, `User`
- [ ] 1.4 Confirm constraints: grant unique on `(organizationId, memberId, source, externalAppId)`
      with non-null `externalAppId`; candidate unique on
      `(organizationId, source, externalAppId)`; `candidateId` on grants is `SetNull`, never
      Cascade
- [ ] 1.5 `cd packages/db && bunx prisma migrate dev --name vendor_discovery && bunx prisma generate`

## 2. Collection check and scope handling

- [ ] 2.1 Add `GoogleWorkspaceToken` / `GoogleWorkspaceTokensResponse` to the Google Workspace
      manifest types
- [ ] 2.2 Add `tokens-fan-out.ts`: bounded worker pool at concurrency 5, per-user error
      classification via the existing `toHttpReadFailure`, early exit after 5 consecutive
      denials, user ceiling that degrades to incomplete. Add no retry — the check context
      already handles 429/5xx/401
- [ ] 2.3 Add `checks/oauth-app-access.ts`: reuse `check-user-filter.ts`; emit per-app rows with
      a scope catalogue and integer scope indices; spill past 500 grantees; always emit the run
      marker; emit the consent finding without throwing. Comment why it declares no `taskMapping`
- [ ] 2.4 Register the check and a `saas-discovery` service on the manifest; add the
      `admin.directory.user.security` scope
- [ ] 2.5 **Verify the platform Google credential has no `customScopes` populated** — custom
      scopes replace rather than union, so the manifest edit would otherwise be a silent no-op.
      Add a warning when manifest scopes are absent from custom scopes
- [ ] 2.6 Add `connection-scopes.service.ts` with granted / required / missing / unknown status;
      export from the integration platform module; surface `missingScopes` and
      `reconnectRequired` additively on connection reads
- [ ] 2.7 Add the reconnect banner to the integration detail view
- [ ] 2.8 Tests: aggregation; spill part numbering; one 403 does not abort; early exit issues
      ~5 calls; marker completeness under each degradation; scope preflight short-circuit; filter
      reuse; concurrency never exceeds 5; **no email in log output**

## 3. Scheduling, resolution and materialisation

- [ ] 3.1 Extract `normalizeWebsite` / `extractDomain` from `vendors.service.ts` into
      `apps/api/src/vendors/vendor-website.ts` and re-import — relocate, do not duplicate
- [ ] 3.2 Add `normalize-vendor-name.ts` and `registrable-domain.ts` (pure, no DB)
- [ ] 3.3 Add `vendor-resolution.service.ts`: existing vendor → global catalogue → integration
      definitions (memoised, 1h TTL), exact-on-normalized only; anonymous and first-party
      pre-filters
- [ ] 3.4 Add the batched inference fallback task (25 names per call, confidence ceiling, never
      auto-approves, no inline web research)
- [ ] 3.5 Add `grant-reconciler.ts` (pure): regroup spill rows, expand scope indices, diff
      observed against stored
- [ ] 3.6 Add `vendor-discovery-materialization.service.ts` implementing the trust predicate;
      resolve members once into user-key and email maps; return unmatched grantees
- [ ] 3.7 Add the internal materialise controller (service-token authenticated, excluded from the
      public API surface)
- [ ] 3.8 Add `vendor-discovery-schedule.ts` (`0 8 * * *`, after employee sync) and
      `run-vendor-discovery.ts` (30-minute budget; preflight scope; own run persistence with the
      real `checkId`)
- [ ] 3.9 Dispatch discovery on connect alongside the existing on-connect checks
- [ ] 3.10 Tests: resolution precedence; a near-miss that must not match; registrable-domain edge
      cases; **the full trust-predicate matrix** asserting withdrawal fires in exactly one case;
      offboarding-revoked grant reappearing stays revoked; member matching prefers user key;
      unmatched grantees reported

## 4. Review queue — API and UI

- [ ] 4.1 Add `discovered-vendors.controller.ts` with list, detail, approve, ignore, reopen,
      rescan; DTOs; standard list and single response envelopes
- [ ] 4.2 Add `GET /v1/vendors/:id/access` and `GET /v1/people/:memberId/vendor-access`
- [ ] 4.3 Import the integration platform module into the vendors module for check-result access
- [ ] 4.4 Approval: transactional status flip plus grant re-association, idempotent on re-approve,
      description fallback chain, acting-user attribution
- [ ] 4.5 Add `use-discovered-vendors.ts` (SWR, no server actions); revalidate both the queue and
      the vendor list after approval
- [ ] 4.6 Add the discovered route, table, approve sheet (prefilled but editable, with duplicate
      warning), grantee list, and reconnect banner
- [ ] 4.7 Add the vendors tab shell, keeping the overview as the default route; pending count badge
- [ ] 4.8 **No bulk-approve control** — vendor research is globally serialised
- [ ] 4.9 Copy states that access was authorized, never that it was recently used; state that only
      Google sign-ins are visible
- [ ] 4.10 Tests: actions hidden without update permission; approve prefill and duplicate warning;
      banner conditional; RBAC per role including employee/contractor refusal and cross-org

## 5. Rewiring

- [ ] 5.1 Split `access-revocation.service.ts` — it is already 312 lines, over the 300-line cap
- [ ] 5.2 Scope the checklist to observed grants, unioned with existing revocations, with the
      full-register fallback when no trustworthy observation exists
- [ ] 5.3 Write the grant withdrawal alongside the attested revocation in one transaction
- [ ] 5.4 Add the "add another vendor" affordance and the provenance indicator to the checklist UI
- [ ] 5.5 Move the hardcoded logo.dev token out of source into configuration
- [ ] 5.6 Add the observed-access section to the employee detail page, extracted into its own
      component to stay under the line cap; keep the existing per-integration sections
- [ ] 5.7 Tests: grant-scoped checklist; fallback when observation is unavailable; both tables
      written transactionally

## Verification

- [ ] V.1 `npx turbo run typecheck --filter=@trycompai/api`
- [ ] V.2 `cd apps/api && npx jest src/vendors src/integration-platform src/offboarding-checklist`
- [ ] V.3 `cd apps/app && npx vitest run`
- [ ] V.4 `bun run lint`
- [ ] V.5 Reconnect Google Workspace; confirm consent requests the new permission and the banner
      clears
- [ ] V.6 Run discovery manually; confirm the run carries the real check id, not `all`, and holds
      exactly one complete marker row
- [ ] V.7 Approve a candidate; confirm the vendor records discovery as its source and grants
      re-associate to it
- [ ] V.8 Confirm a grantee's employee page shows the application
- [ ] V.9 Confirm offboarding lists only that person's vendors
- [ ] V.10 **Negative test.** Revoke one app for one user in Google, re-run, confirm exactly that
      grant is withdrawn and nothing else. Then force an incomplete run and confirm **no**
      withdrawals occur
- [ ] V.11 Responsive check at 375 / 768 / 1280 / 1920
