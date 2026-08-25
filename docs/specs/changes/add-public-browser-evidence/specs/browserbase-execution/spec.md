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

### Requirement: Public steps support screenshot evaluation

Public browser evidence steps SHALL support the same screenshot upload and
evaluation result fields as authenticated steps.

#### Scenario: Public step with pass/fail criteria

- **GIVEN** a public automation step with evaluation criteria
- **WHEN** the evidence run completes
- **THEN** the result SHALL include `evaluationStatus` and `evaluationReason`
  when evaluation is available
- **AND** the result SHALL include screenshot URLs when upload succeeds.

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

