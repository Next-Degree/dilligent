# Browser Credential Vault Bitwarden Delta

## ADDED Requirements

### Requirement: Bitwarden is the primary browser credential vault

The system SHALL use Bitwarden for newly stored Browserbase password-mode
credentials.

#### Scenario: User stores a browser login

- **GIVEN** Bitwarden credential storage is configured
- **AND** a user saves a browser connection username and password
- **WHEN** the API stores the connection credentials
- **THEN** the system SHALL create or update a Bitwarden item for that browser
  auth profile
- **AND** update `BrowserAuthProfile.vaultProvider` to `bitwarden`
- **AND** update `BrowserAuthProfile.vaultExternalItemRef` to an opaque
  Bitwarden reference
- **AND** not persist the raw username, password, TOTP seed, or TOTP code in the
  database.

#### Scenario: Bitwarden is not configured

- **GIVEN** Bitwarden credential storage is not configured
- **WHEN** a user tries to store password-mode browser credentials
- **THEN** the API SHALL return the same class of service-unavailable error used
  for an unconfigured credential vault
- **AND** no plaintext credential material SHALL be persisted.

### Requirement: Credential resolution remains provider-agnostic

Browser run-time credential resolution SHALL continue through the
`BrowserCredentialVaultAdapter` contract.

#### Scenario: Browser run resolves Bitwarden credentials

- **GIVEN** a browser auth profile with `vaultProvider` set to `bitwarden`
- **AND** a Bitwarden `vaultExternalItemRef`
- **WHEN** a password-mode browser automation needs to sign in
- **THEN** the credential vault adapter SHALL resolve username, password,
  optional TOTP code, and optional extra login fields from Bitwarden
- **AND** return them as `RuntimeCredentialMaterial`.

#### Scenario: Unsupported provider

- **GIVEN** a browser auth profile with a provider not supported by the active
  adapter
- **WHEN** the browser run tries to resolve credentials
- **THEN** the adapter SHALL return null without logging secret values.

### Requirement: Bitwarden stores all current credential fields

The Bitwarden implementation SHALL preserve the existing browser credential
feature set.

#### Scenario: Login has site-specific extra fields

- **GIVEN** a stored login includes extra fields such as workspace, account id,
  subdomain, or tenant
- **WHEN** credentials are stored in Bitwarden
- **THEN** those fields SHALL be stored with labels and values
- **AND** returned during run-time credential resolution.

#### Scenario: Login has automatic 2FA

- **GIVEN** a browser auth profile has an authenticator setup key
- **WHEN** credentials are stored or updated in Bitwarden
- **THEN** Bitwarden SHALL store the TOTP setup key securely
- **AND** run-time resolution SHALL return a fresh TOTP code equivalent to the
  current 1Password behavior.

### Requirement: Existing 1Password profiles are migratable

The system SHALL include an operator-run migration path from 1Password references
to Bitwarden references.

#### Scenario: Migration dry run

- **GIVEN** 1Password read access and Bitwarden write access are configured
- **WHEN** the operator runs the migration in dry-run mode
- **THEN** the command SHALL report how many profiles are eligible, skipped, and
  blocked
- **AND** not create Bitwarden items
- **AND** not update database rows
- **AND** not print secret values.

#### Scenario: Profile migrates successfully

- **GIVEN** a browser auth profile has `vaultProvider` set to `1password`
- **AND** the profile has a valid `op://` external reference
- **WHEN** the migration runs
- **THEN** the migration SHALL read credential material through the 1Password
  adapter
- **AND** write equivalent credential material to Bitwarden
- **AND** update the profile to `vaultProvider: "bitwarden"`
- **AND** update `vaultExternalItemRef` to the Bitwarden reference
- **AND** preserve `identifierLabel` and connection metadata.

#### Scenario: Migration is resumed

- **GIVEN** a previous migration partially completed
- **WHEN** the migration runs again
- **THEN** already migrated Bitwarden profiles SHALL be skipped
- **AND** profiles still pointing at 1Password SHALL be retried
- **AND** duplicate Bitwarden items SHALL not be created for the same profile.

### Requirement: 1Password support is temporary during migration

The system SHALL support a migration window where old 1Password references can
still be read, then remove 1Password after all profiles are migrated.

#### Scenario: Existing profile before migration

- **GIVEN** a browser auth profile still has `vaultProvider` set to `1password`
- **AND** 1Password is configured
- **WHEN** an existing scheduled browser automation runs during the migration
  window
- **THEN** the system SHALL still resolve the stored credentials from 1Password.

#### Scenario: New credential write during migration

- **GIVEN** both 1Password and Bitwarden are configured
- **WHEN** a user saves or updates browser credentials
- **THEN** the write SHALL go to Bitwarden
- **AND** the profile SHALL be updated to `vaultProvider: "bitwarden"`.

#### Scenario: Migration is complete

- **GIVEN** no browser auth profiles remain with `vaultProvider` set to
  `1password`
- **WHEN** 1Password support is removed
- **THEN** the application SHALL not depend on `@1password/sdk`
- **AND** `OP_SERVICE_ACCOUNT_TOKEN` SHALL no longer be required for browser
  credential storage.

### Requirement: UI identifies Bitwarden-secured connections

The browser connection UI SHALL describe password-mode connections as secured by
Bitwarden.

#### Scenario: Connection has Bitwarden credentials

- **GIVEN** a browser connection has `vaultProvider` set to `bitwarden`
- **WHEN** the connection appears in settings or task browser automation UI
- **THEN** the UI SHALL show Bitwarden-secured status copy
- **AND** not show 1Password-specific copy or `op://` references.

## MODIFIED Requirements

### Requirement: Browser credential storage service writes to configured vault

The browser credential storage service SHALL write through a Bitwarden-backed
storage path instead of using 1Password SDK types directly.

#### Scenario: Re-saving an existing Bitwarden login

- **GIVEN** a browser auth profile already points at a Bitwarden item
- **WHEN** a user re-saves the login
- **THEN** the existing Bitwarden item SHALL be updated in place when possible
- **AND** the profile reference SHALL remain stable unless the item no longer
  exists.

#### Scenario: Deleting a browser connection

- **GIVEN** a browser auth profile points at a Bitwarden item
- **WHEN** the browser connection is deleted
- **THEN** the system SHALL best-effort delete or archive the Bitwarden item
- **AND** a vault cleanup failure SHALL not block deleting the browser
  connection.

