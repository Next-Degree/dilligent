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
- Keep existing 1Password profiles readable only during the migration window.
- Remove 1Password dependencies and configuration after migration is complete.

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

- Existing credentials can only be migrated if both 1Password read access and
  Bitwarden write access are configured during the migration window.
- TOTP handling must remain equivalent to the current behavior: store the setup
  key securely and resolve a fresh code at browser-run time.
- Bitwarden API limits or collection/project permissions may affect bulk
  migration; the migration must be resumable and idempotent.
- Removing 1Password too early would break existing password-mode browser
  profiles that still point at `op://` references.

