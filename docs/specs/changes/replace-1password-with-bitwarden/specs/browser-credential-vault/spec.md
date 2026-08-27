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

#### Scenario: Run-time resolution returns a code, never a seed

- **GIVEN** a Bitwarden-backed profile with a stored authenticator setup key
- **WHEN** the credential vault adapter resolves credentials for a browser run
- **THEN** `RuntimeCredentialMaterial.totpCode` SHALL carry a currently valid
  one-time code
- **AND** SHALL NOT carry the stored setup key
- **AND** the setup key SHALL NOT appear in any log, error, or run record.

#### Scenario: Setup key stored as an otpauth URI

- **GIVEN** a user supplies a full `otpauth://` URI rather than a bare Base32
  secret
- **WHEN** the credential is stored and later resolved
- **THEN** the code SHALL be generated using the parameters carried in that URI
  rather than assumed defaults.

### Requirement: Credential resolution dispatches on the profile's provider

During the migration window a single deployment holds both 1Password-backed and
Bitwarden-backed profiles, so the provider is a property of the profile, not of
the environment.

#### Scenario: Mixed providers in one organization

- **GIVEN** one browser auth profile with `vaultProvider` set to `1password`
- **AND** another with `vaultProvider` set to `bitwarden`
- **AND** both vaults are configured
- **WHEN** each profile's automation runs
- **THEN** each SHALL resolve its credentials from its own provider
- **AND** neither SHALL fail because the other provider is also configured.

#### Scenario: Profile's provider is not configured

- **GIVEN** a profile with `vaultProvider` set to a vault that this deployment
  has no credentials for
- **WHEN** the browser run tries to resolve credentials
- **THEN** resolution SHALL return null rather than throwing
- **AND** the run SHALL fall back to the existing human re-auth behavior.

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

### Requirement: Automatic-2FA status is preserved for Bitwarden profiles

The connections UI reads 2FA status live from the vault, and distinguishes
"off" from "could not read".

#### Scenario: Bulk status for an organization

- **GIVEN** an organization with several Bitwarden-backed password connections
- **WHEN** the connections list loads their automatic-2FA statuses
- **THEN** each readable connection SHALL report true or false
- **AND** a connection whose item cannot be read SHALL be omitted from the
  result rather than reported as false
- **AND** the reads SHALL be bounded rather than fanning out one request per
  connection at once.

#### Scenario: Setting a key on a connection with no stored login

- **GIVEN** a Bitwarden-backed profile with no stored credential item
- **WHEN** a user tries to attach an authenticator setup key
- **THEN** the API SHALL reject the request with the same guidance used today
- **AND** SHALL NOT create a credential item holding only a TOTP seed.

#### Scenario: Clearing a key is idempotent

- **GIVEN** a Bitwarden-backed profile with no stored authenticator key
- **WHEN** automatic 2FA is turned off
- **THEN** the call SHALL succeed as a no-op.

### Requirement: UI identifies Bitwarden-secured connections

The browser connection UI SHALL describe password-mode connections as secured by
Bitwarden.

#### Scenario: Connection has Bitwarden credentials

- **GIVEN** a browser connection has `vaultProvider` set to `bitwarden`
- **WHEN** the connection appears in settings or task browser automation UI
- **THEN** the UI SHALL show Bitwarden-secured status copy
- **AND** not show 1Password-specific copy or `op://` references.

#### Scenario: Secured badge stays provider-agnostic

- **GIVEN** a connection with stored credentials
- **WHEN** the connection sheet renders
- **THEN** whether the secured row appears SHALL continue to depend on the
  presence of credentials, not on a hard-coded provider string.

### Requirement: Removing 1Password leaves the 1Password integration intact

The 1Password *integration* in the integrations catalog monitors a customer's
own 1Password tenant and is unrelated to Comp's credential vault.

#### Scenario: Post-migration cleanup

- **GIVEN** no browser auth profiles remain on `vaultProvider: "1password"`
- **WHEN** 1Password credential-vault support is removed
- **THEN** the 1Password integration catalog entry SHALL remain available
- **AND** customers connected to that integration SHALL be unaffected.

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

