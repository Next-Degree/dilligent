# Replace 1Password With Bitwarden for Browser Credential Storage

## Why

Browser automation password-mode connections currently store credentials in
1Password and keep only a vault reference on `BrowserAuthProfile`. That keeps raw
secrets out of the database, but it couples the Browserbase credential storage
path to 1Password-specific SDK types, `op://` references, per-org vault creation,
and `OP_SERVICE_ACCOUNT_TOKEN`.

We want Bitwarden to become the password manager for browser automation
credentials while preserving the same security property: Comp stores only an
external vault reference, and credentials are resolved just in time during a
browser run.

## What Changes

- Add a Bitwarden credential vault implementation for Browserbase password
  connections.
- New stored credentials use `vaultProvider: "bitwarden"` and a Bitwarden-backed
  `vaultExternalItemRef`.
- Keep `vaultExternalItemRef` opaque outside the Bitwarden adapter; application
  code should not parse provider-specific reference internals.
- Replace UI copy that names 1Password with Bitwarden.
- Add a migration utility for existing `vaultProvider: "1password"` profiles:
  read from 1Password, write to Bitwarden, then update the profile reference.
- Keep existing 1Password profiles readable only during the migration window,
  which requires resolving the vault adapter per profile rather than picking one
  adapter per deployment as `browser-credential-vault.factory.ts` does today.
- Remove 1Password dependencies and configuration after migration is complete —
  the credential-vault modules only, leaving the unrelated 1Password customer
  integration in place.

## Non-Goals

- Do not store plaintext usernames, passwords, TOTP seeds, or TOTP codes in the
  database.
- Do not change Browserbase saved-session or public-page execution semantics.
- Do not migrate unrelated integration-platform credentials.
- Do not require customers to reconnect every browser profile solely because the
  backend vault provider changed.
- Do not expose provider-specific vault references in UI beyond a generic
  "secured by Bitwarden" status.

## Risks

- **TOTP code generation is the load-bearing risk, and it is not a like-for-like
  swap.** Comp does not generate one-time codes — it delegates that to
  1Password. `buildTotpReference` appends `?attribute=otp`
  (`onepassword-credential-item.ts:36-40`), which makes 1Password compute the
  live 6-digit code server-side, and the adapter returns that *code*, never the
  seed. `apps/api` has no TOTP library at all, so whichever Bitwarden product is
  chosen must either compute codes itself or the API must start doing so. This
  decides the whole shape of the migration and should be settled before any
  other work — see the open question below.
- Existing credentials can only be migrated if both 1Password read access and
  Bitwarden write access are configured during the migration window.
- During that window two providers are live at once, but
  `resolveBrowserCredentialVaultAdapter()` returns a single adapter chosen by
  which vault is configured, and each adapter no-ops on a foreign
  `vaultProvider`. Reads must dispatch per profile, not per deployment.
- Bitwarden API limits or collection/project permissions may affect bulk
  migration; the migration must be resumable and idempotent.
- Removing 1Password too early would break existing password-mode browser
  profiles that still point at `op://` references.
- **There is a separate, unrelated 1Password customer integration** — an Events
  API monitor in `integrations-catalog/integrations/1password.json` and
  `apps/app/.../integrations/data/categories/infrastructure.ts`. A cleanup that
  greps for "1password" will delete a shipped integration. The removal step must
  name the credential-vault modules explicitly.
- The 1Password SDK ships a native WASM core kept out of the Trigger bundle via
  `external: ['@1password/sdk']` (`apps/api/trigger.config.ts:19-21`). The
  Bitwarden SDK has the same shape, so the replacement needs the equivalent
  entry or Trigger tasks will fail to bundle.

## Open Question — which Bitwarden product

The two options are not interchangeable and the answer changes the adapter, the
reference format, and the TOTP story:

- **Secrets Manager** is the machine-oriented API (projects, opaque key/value
  secrets, machine accounts). It fits service-to-service access well, but it
  stores no structured login and computes no TOTP, so Comp would have to
  generate codes itself from the stored seed and model username/password/extra
  fields inside the secret payload.
- **Password Manager** has structured login items, collections, and native TOTP,
  which maps closely onto today's behavior — but its API is organization/vault
  oriented rather than built for unattended service access.

Recommendation: Password Manager if its API supports unattended machine access
in our deployment, since it preserves TOTP semantics with the least new
security-sensitive code; otherwise Secrets Manager plus an audited TOTP
implementation in `apps/api`. Decide this first.

