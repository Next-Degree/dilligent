# Browserbase Execution Public Evidence Delta

## ADDED Requirements

### Requirement: Browser automation steps can run without authentication

The system SHALL support a per-step browser evidence mode that explicitly marks
a step as public/no-auth.

#### Scenario: Public privacy policy evidence

- **GIVEN** an automation step with `authMode` set to `public`
- **AND** `targetUrl` set to a public privacy policy URL
- **WHEN** the automation runs
- **THEN** the system SHALL navigate to the target URL without resolving or
  creating a BrowserAuthProfile
- **AND** the system SHALL not attempt stored-credential login
- **AND** the system SHALL capture and upload browser evidence.

#### Scenario: Public step has no saved connection

- **GIVEN** an automation step with `authMode` set to `public`
- **AND** `profileId` is null
- **WHEN** the automation runs
- **THEN** the run SHALL proceed without returning "No connection is bound to
  this step."

#### Scenario: Public step never creates a connection as a side effect

- **GIVEN** an organization with no BrowserAuthProfile for `example.com`
- **AND** a public step targeting `https://example.com/privacy`
- **WHEN** the automation runs, or the step is tested from the composer
- **THEN** no BrowserAuthProfile SHALL be created for `example.com`
- **AND** the organization's connection list SHALL be unchanged after the run.

#### Scenario: Public step ignores an unrelated saved connection

- **GIVEN** a public step targeting `https://example.com/privacy`
- **AND** the organization has a verified BrowserAuthProfile for `example.com`
- **WHEN** the automation runs
- **THEN** the run SHALL NOT attach that profile's browser context
- **AND** the captured evidence SHALL reflect the signed-out public page.

### Requirement: Public browser sessions are non-persistent

Public browser evidence steps SHALL run in fresh Browserbase sessions that do
not persist cookies or local browser state into organization auth contexts.

#### Scenario: Public session completes

- **GIVEN** a public browser evidence step
- **WHEN** the run completes
- **THEN** the Browserbase session SHALL be closed
- **AND** no BrowserAuthProfile context SHALL be updated.

#### Scenario: Public session fails

- **GIVEN** a public browser evidence step
- **WHEN** navigation, action, screenshot, upload, or evaluation fails
- **THEN** the Browserbase session SHALL still be closed
- **AND** no BrowserAuthProfile health status SHALL be changed.

#### Scenario: Public session carries no organization browser state

- **GIVEN** a public browser evidence step
- **WHEN** its Browserbase session is created
- **THEN** the session SHALL NOT be created on any BrowserAuthProfile's
  `contextId`
- **AND** the session SHALL be created with state persistence disabled
- **AND** the context backing it SHALL NOT be written to any database row.

### Requirement: Public runs do not serialize on connection locks

Public steps have no connection to protect from concurrent use, but still share
a target host with other runs.

#### Scenario: Two public runs on unrelated hosts

- **GIVEN** two public steps targeting different hostnames
- **WHEN** both run at the same time
- **THEN** neither SHALL wait on the other's completion.

#### Scenario: Repeated public runs against one host

- **GIVEN** consecutive public steps targeting the same hostname
- **WHEN** they run
- **THEN** the system SHALL apply the same per-domain pacing used by
  authenticated runs
- **AND** SHALL NOT require a profile identifier to do so.

### Requirement: Authenticated browser automations remain unchanged by default

Existing browser automations SHALL continue to use saved browser auth profiles
unless explicitly marked public.

#### Scenario: Legacy automation with null profileId

- **GIVEN** an existing automation step with no `authMode` value
- **AND** `profileId` is null
- **WHEN** the automation runs
- **THEN** the system SHALL treat the step as `saved_session`
- **AND** continue resolving a matching BrowserAuthProfile by target hostname.

#### Scenario: Authenticated step needs login

- **GIVEN** an automation step with `authMode` set to `saved_session`
- **WHEN** the target page is not logged in
- **THEN** the system SHALL keep the current auth detection and stored-credential
  relogin behavior.

#### Scenario: Mixed automation

- **GIVEN** an automation whose step 1 is `saved_session` and step 2 is `public`
- **WHEN** the automation runs
- **THEN** step 1 SHALL run on its connection's saved session
- **AND** step 2 SHALL run in a fresh public session
- **AND** the run verdict SHALL roll up both steps as it does today.

### Requirement: Public steps support screenshot evaluation

Public browser evidence steps SHALL support the same screenshot upload and
evaluation result fields as authenticated steps.

#### Scenario: Public step with pass/fail criteria

- **GIVEN** a public automation step with evaluation criteria
- **WHEN** the evidence run completes
- **THEN** the result SHALL include `evaluationStatus` and `evaluationReason`
  when evaluation is available
- **AND** the result SHALL include screenshot URLs when upload succeeds.

### Requirement: Public run records omit connection bookkeeping

A run whose first step is public has no connection to attribute or to mark
healthy or unhealthy.

#### Scenario: Run record for a public-first automation

- **GIVEN** an automation whose first step is public
- **WHEN** the run is created
- **THEN** the run SHALL be recorded with a null `profileId`
- **AND** the per-step run record SHALL complete with its own status and
  evidence.

#### Scenario: Public step fails

- **GIVEN** a public step
- **WHEN** the step fails for any reason
- **THEN** no BrowserAuthProfile SHALL be marked verified, needs_reauth, or
  blocked as a result.

### Requirement: The UI can author public browser evidence

The browser automation composer SHALL allow users to create or edit a step that
does not require a saved login.

#### Scenario: User selects public page mode

- **GIVEN** the user is composing browser evidence
- **WHEN** the user selects "Public page / no login"
- **THEN** the UI SHALL allow entering a target URL
- **AND** save the step with `authMode: "public"` and `profileId: null`.

#### Scenario: Public step reconnect prompt

- **GIVEN** a saved public step
- **WHEN** the automation list renders
- **THEN** the UI SHALL NOT show reconnect or needs-reauth actions for that step.

#### Scenario: Authenticated step keeps deriving its URL

- **GIVEN** a step in saved-session mode
- **WHEN** the user composes it
- **THEN** the step's target URL SHALL continue to come from the selected
  connection
- **AND** no manual URL entry SHALL be required.

#### Scenario: Public step blocks saving until it has a URL

- **GIVEN** a public step with an empty or unparseable target URL
- **WHEN** the user tries to save the automation
- **THEN** saving SHALL be blocked with a message naming the offending step.

#### Scenario: Public step does not block saving on connection health

- **GIVEN** an automation containing a public step
- **AND** the organization's connections include an unverified one
- **WHEN** the user saves
- **THEN** the public step SHALL NOT be treated as needing a fix
- **AND** SHALL NOT contribute to a "fix step N to save" block.

### Requirement: Public evidence is authorable without any connection

Capturing a public page is the one browser-evidence flow that needs no vendor
login, so it SHALL NOT be gated behind having connected one.

#### Scenario: Organization with no connections

- **GIVEN** an organization with no BrowserAuthProfile at all
- **AND** a task with no saved automations
- **WHEN** the user opens browser evidence for that task
- **THEN** the UI SHALL offer creating public-page evidence
- **AND** SHALL NOT require connecting a vendor login first.

### Requirement: Public steps are testable before saving

The composer's per-step test SHALL work for public steps.

#### Scenario: Testing a public step

- **GIVEN** an unsaved public step with a target URL and instruction
- **WHEN** the user tests that step
- **THEN** the test SHALL run in a fresh public session
- **AND** SHALL stream its live view and timeline as an authenticated test does
- **AND** SHALL NOT create or resolve a BrowserAuthProfile.

### Requirement: Public step drafts round-trip

An in-progress public step SHALL survive autosave and resume.

#### Scenario: Resuming a public draft

- **GIVEN** a draft containing a public step with a target URL
- **WHEN** the user resumes that draft
- **THEN** the step SHALL still be in public mode
- **AND** its target URL SHALL be restored.

### Requirement: User-entered target URLs are validated

Public mode is the first flow where a browser-evidence URL comes from user
input rather than from a server-created connection, so URL safety checks SHALL
apply on every path that accepts one.

#### Scenario: Unsafe public target URL

- **GIVEN** a public step whose target URL points at a blocked address
- **WHEN** the step is saved, drafted, or tested
- **THEN** the API SHALL reject it with a validation error
- **AND** no Browserbase session SHALL be opened for it.
