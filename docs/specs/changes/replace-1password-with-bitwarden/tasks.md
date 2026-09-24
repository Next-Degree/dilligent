## Decide First

**Which Bitwarden product** — see the open question in `proposal.md`. Secrets
Manager and Password Manager differ in whether they store a structured login and
whether they compute TOTP codes. Everything below assumes structured login items
with native TOTP (the Password Manager shape); on Secrets Manager, add a
credential-payload schema and an audited TOTP implementation to the plan.

**How TOTP codes get generated.** Comp does not generate them today. The
1Password adapter asks the vault for a computed code via the `?attribute=otp`
modifier (`onepassword-credential-item.ts:36-40`) and returns that code;
`apps/api` carries no TOTP library. If Bitwarden will not compute the code, this
change introduces first-party generation of authentication secrets — new
security-sensitive code that needs its own review, not an incidental detail of
an adapter swap.

**Reference format.** `vaultExternalItemRef` is meant to be opaque outside the
adapter, but `browser-credential-storage.service.ts` parses it inline at five
points (lines 77-79, 278, 313, 350, 388) via `parseItemReference`. Either the
storage service moves behind the adapter contract, or "opaque" is not true and
the spec should say so. Prefer the former.

## Affected Code

Verified against the current tree.

1. `credential-vault.ts` — the provider-neutral contract
   (`BrowserCredentialVaultAdapter`, `RuntimeCredentialMaterial`,
   `NoopBrowserCredentialVaultAdapter`). This already has the right shape and
   should not need to change.
2. `browser-credential-vault.factory.ts` — picks **one** adapter per deployment
   from `isOnePasswordConfigured()`. Since each adapter returns null for a
   foreign `provider`, a mixed-provider deployment silently resolves nothing for
   half its profiles. Needs to become a dispatching or composite adapter keyed
   on the profile's `vaultProvider`.
3. `onepassword-credential-vault.adapter.ts` — the read path to mirror:
   parallel username/password resolution, TOTP resolved separately "so its
   rotation window is as fresh as possible", extra fields filtered against
   `RESERVED_FIELD_TITLES`, and a null return when nothing resolved.
4. `browser-credential-storage.service.ts` — the write path, and the largest
   piece of work. Imports `Item` and `ItemField` **types** directly from
   `@1password/sdk` (line 9), so the coupling is structural, not just at the
   call sites. Covers: `storeProfileCredentials`, `updateExistingLoginItem`
   (read-modify-write with `items.put`, plus the `keepStoredTotp` carry-over),
   `getProfileTotpStatus`, `getOrgTotpStatuses` (bounded `CONCURRENCY = 5`, with
   unreadable items **omitted** rather than reported false),
   `setProfileTotp`, `clearProfileTotp`, `deleteProfileCredentialItem`
   (best-effort, never throws), `ensureOrgVault`, and `buildLoginFields`.
5. `onepassword-credential-item.ts` — the shared write/read contract: provider
   string, field titles (`username`, `password`, `one-time password`), the
   `op://` reference builders, and `buildOrgVaultTitle`, which is per
   organization and still carries the old "Comp AI" product name.
6. `onepassword-client.ts` — env parsing, configured-state check, client
   caching. The Bitwarden equivalent is a direct analogue.
7. `apps/api/trigger.config.ts:19-21` — `external: ['@1password/sdk']`, there
   because the SDK ships a native WASM core. The Bitwarden SDK needs the same
   treatment.
8. UI copy — four strings, all literal:
   - `BrowserEmptyStates.tsx:54` — "Encrypted · stored in 1Password · evidence only"
   - `ConnectCaptureForm.tsx:113` and `:226`
   - `MakePermanentSheet.tsx:189` — "Encrypted and stored in your 1Password vault."
   - `ManageConnectionSheet.tsx:177` — "Secured by 1Password"

   Note `ManageConnectionSheet.tsx:116` already derives `secured` from
   `Boolean(connection.vaultProvider || connection.vaultExternalItemRef)`, so the
   gating is provider-agnostic today. Only the strings are hard-coded — this task
   is smaller than it looks.

**Do not touch** `integrations-catalog/integrations/1password.json` or the
`1password` entry in
`apps/app/src/app/(app)/[orgId]/integrations/data/categories/infrastructure.ts`.
That is a customer-facing 1Password Events API integration, unrelated to the
credential vault, and a grep-driven cleanup will remove it by accident.

## Implementation

- [ ] Settle the two "Decide First" questions and record the answers here.
- [ ] Introduce Bitwarden credential vault constants and reference helpers.
  - Provider string: `bitwarden`.
  - Keep the reference format opaque outside the Bitwarden adapter.
  - Preserve the standard field labels: username, password, one-time password,
    and extra site-specific fields.
  - Give the per-organization container a title that does not carry the old
    product name (`buildOrgVaultTitle` currently reads "Comp AI Browser
    Automations — <orgId>").
- [ ] Add a Bitwarden client wrapper.
  - Centralize environment parsing and configured-state checks.
  - Cache the client safely and reset the cache after transient init failures.
  - Redact request, response, and error details that may include secret values.
  - Add the SDK to Trigger's `external` list if it ships a native core.
- [ ] Add a Bitwarden implementation of `BrowserCredentialVaultAdapter`.
  - Resolve username, password, TOTP code, and extra fields at run time.
  - Return null for unsupported providers or missing references.
  - Do not log secret values or provider raw payloads.
- [ ] Make adapter resolution dispatch per profile.
  - `resolveBrowserCredentialVaultAdapter()` returns a composite that routes on
    `params.provider` and delegates to whichever concrete adapter is configured.
  - An unconfigured provider resolves null rather than throwing, preserving the
    Noop fallback's human re-auth behavior.
- [ ] Refactor `BrowserCredentialStorageService` off direct 1Password SDK types.
  - Drop the `import type { Item, ItemField } from '@1password/sdk'`.
  - New credential writes create or update Bitwarden items.
  - Re-saving a login updates the existing item in place when possible, keeping
    the stored reference stable so an in-flight scheduled run still resolves.
  - Preserve the current failure split: only an unreadable item falls back to
    creating a replacement; a write failure propagates rather than orphaning the
    old item and repointing the profile.
  - Preserve `keepStoredTotp` — a re-save without a new key keeps the stored one.
  - TOTP status, set TOTP, clear TOTP, and delete all work for Bitwarden-backed
    profiles, including the omit-on-unreadable semantics in `getOrgTotpStatuses`
    and its bounded concurrency.
- [ ] Preserve temporary 1Password read support for migration.
  - Existing `vaultProvider: "1password"` profiles remain runnable while
    `OP_SERVICE_ACCOUNT_TOKEN` is configured.
  - New writes never create new 1Password items.
  - Clearly mark 1Password code as migration-only.
- [ ] Add an idempotent migration command.
  - Dry-run mode reports eligible, migrated, skipped, and failed counts.
  - Reads existing credential material from 1Password.
  - Writes equivalent items to Bitwarden.
  - Updates `vaultProvider`, `vaultExternalItemRef`, and `vaultConnectionId`
    only after the Bitwarden write succeeds.
  - Avoids duplicate Bitwarden items when retried.
  - Note the TOTP constraint: the 1Password read path returns a computed
    *code*, not the seed, so migrating a login's 2FA needs a seed-reading path
    that does not exist today. Either add one for the migration, or accept that
    2FA must be re-entered per connection and say so in the UI.
- [ ] Update API DTOs and response documentation where provider examples appear.
  - Use Bitwarden examples instead of `1password` / `op://`.
  - Keep DTO fields generic: `vaultProvider`, `vaultExternalItemRef`,
    `vaultConnectionId`.
- [ ] Update browser connection UI copy.
  - Replace the four literal strings listed above.
  - Leave the `secured` derivation alone — it is already provider-agnostic.
- [ ] Remove 1Password dependencies after migration completion.
  - Remove `@1password/sdk` from `apps/api/package.json`.
  - Remove it from `apps/api/trigger.config.ts`'s `external` list.
  - Delete the credential-vault modules by name — `onepassword-client.ts`,
    `onepassword-credential-item.ts`, `onepassword-credential-vault.adapter.ts`,
    and their specs — once no production rows require
    `vaultProvider: "1password"`.
  - Leave the 1Password *integration* catalog entry and its UI entry in place.
  - Remove `OP_SERVICE_ACCOUNT_TOKEN` from deployment documentation.

## Tests

- [ ] Bitwarden adapter unit tests with mocked client responses.
- [ ] Adapter returns a live TOTP code, never the stored seed.
- [ ] Adapter returns null when nothing resolved, and for a foreign provider.
- [ ] Composite adapter routes a `1password` profile and a `bitwarden` profile to
      their own backends within one deployment.
- [ ] Composite adapter returns null (does not throw) when the profile's provider
      is unconfigured.
- [ ] Storage service: create, update-in-place, delete, TOTP status, set TOTP,
      clear TOTP, and the unconfigured-vault error path.
- [ ] Update-in-place keeps the reference stable and carries the stored TOTP
      across a re-save with no new key.
- [ ] An unreadable item falls back to creating a replacement; a write failure
      propagates instead.
- [ ] `getOrgTotpStatuses` omits unreadable connections rather than reporting
      false, and respects its concurrency bound.
- [ ] Migration: dry-run, success, missing 1Password item, Bitwarden write
      failure, and retry/idempotency.
- [ ] No test asserts a secret value appears in a log or error message.
- [ ] Browser credential login tests remain provider-agnostic.
- [ ] UI tests updated for the new copy; the existing fixtures pin
      `vaultProvider: '1password'` (`ConnectionsTable.test.tsx:29`,
      `MakePermanentSheet.test.tsx:39`, `ManageConnectionSheet.test.tsx:53`) and
      `ManageConnectionSheet.test.tsx:85` asserts the literal "Secured by
      1Password".

## Verification

- [ ] `cd apps/api && npx jest src/browserbase --passWithNoTests`
- [ ] `npx turbo run typecheck --filter=@trycompai/api`
- [ ] `cd apps/app && npx vitest run` for browser connection settings and task
      browser automation UI.
- [ ] Manual: save a new password-mode browser connection; confirm the profile
      stores `vaultProvider: "bitwarden"` and no plaintext secrets.
- [ ] Manual: run a password-mode browser automation and confirm Bitwarden
      credentials are resolved for sign-in.
- [ ] Manual: add, verify, and clear automatic 2FA for a Bitwarden-backed
      connection, and confirm an unattended run completes a 2FA challenge.
- [ ] Manual: migrate one existing 1Password-backed profile in dry-run and live
      mode, then run its scheduled automation.
- [ ] Manual: with both vaults configured, confirm a not-yet-migrated profile
      and a migrated one both run.
- [ ] Confirm the 1Password integration still appears in the integrations
      catalog after the cleanup step.
