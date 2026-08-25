## Implementation

- [ ] Introduce Bitwarden credential vault constants and reference helpers.
  - Provider string: `bitwarden`.
  - Keep the reference format opaque outside the Bitwarden adapter.
  - Preserve standard field labels: username, password, one-time password, and
    extra site-specific fields.
- [ ] Add a Bitwarden client wrapper.
  - Centralize environment parsing and configured-state checks.
  - Cache the client safely and reset the cache after transient init failures.
  - Redact request, response, and error details that may include secret values.
- [ ] Add a Bitwarden implementation of `BrowserCredentialVaultAdapter`.
  - Resolve username, password, TOTP code, and extra fields at run time.
  - Return null for unsupported providers or missing references.
  - Do not log secret values or provider raw payloads.
- [ ] Refactor `BrowserCredentialStorageService` off direct 1Password SDK types.
  - New credential writes create or update Bitwarden items.
  - Re-saving a login updates an existing Bitwarden item in place when possible.
  - TOTP status, set TOTP, clear TOTP, and delete credential item all work for
    Bitwarden-backed profiles.
- [ ] Preserve temporary 1Password read support for migration.
  - Existing `vaultProvider: "1password"` profiles remain runnable while
    `OP_SERVICE_ACCOUNT_TOKEN` is configured.
  - New writes never create new 1Password items.
  - Clearly mark 1Password code as migration-only.
- [ ] Add an idempotent migration command.
  - Dry-run mode reports eligible, migrated, skipped, and failed counts.
  - Reads existing credential material from 1Password.
  - Writes equivalent items to Bitwarden.
  - Updates `BrowserAuthProfile.vaultProvider`, `vaultExternalItemRef`, and
    `vaultConnectionId` only after the Bitwarden write succeeds.
  - Avoids duplicate Bitwarden items when retried.
- [ ] Update API DTOs and response documentation where provider examples appear.
  - Use Bitwarden examples instead of `1password` / `op://`.
  - Keep DTO fields generic: `vaultProvider`, `vaultExternalItemRef`,
    `vaultConnectionId`.
- [ ] Update browser connection UI copy and tests.
  - Replace "stored in 1Password" and "Secured by 1Password" with Bitwarden
    wording.
  - Keep UI behavior based on credential presence, not a hard-coded provider
    string, except where provider-specific status text is required.
- [ ] Remove 1Password dependencies after migration completion.
  - Remove `@1password/sdk` from `apps/api/package.json`.
  - Remove `@1password/sdk` from Trigger external configuration.
  - Delete 1Password-only modules and tests once no production rows require
    `vaultProvider: "1password"`.
  - Remove `OP_SERVICE_ACCOUNT_TOKEN` from deployment documentation.
- [ ] Update tests.
  - Bitwarden adapter unit tests with mocked client responses.
  - Storage service tests for create, update, delete, TOTP status, set TOTP,
    clear TOTP, and missing-vault configuration.
  - Migration tests for dry-run, success, missing 1Password item, Bitwarden
    write failure, and retry/idempotency.
  - Browser credential login tests remain provider-agnostic.

## Verification

- [ ] `cd apps/api && bunx jest src/browserbase --passWithNoTests`
- [ ] Relevant app Vitest tests pass for browser connection settings and task
      browser automation UI.
- [ ] Manual test: save a new password-mode browser connection and confirm the
      profile stores `vaultProvider: "bitwarden"` with no plaintext secrets.
- [ ] Manual test: run a password-mode browser automation and confirm Bitwarden
      credentials are resolved for sign-in.
- [ ] Manual test: add, verify, and clear automatic 2FA for a Bitwarden-backed
      connection.
- [ ] Manual test: migrate one existing 1Password-backed profile in dry-run and
      live mode, then run its scheduled automation.

