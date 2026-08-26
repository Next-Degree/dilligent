# Google Workspace Integration — Delta

## ADDED Requirements

### Requirement: Third-Party OAuth Grant Collection

The Google Workspace integration SHALL provide a check that collects, for every in-scope
directory user, the third-party OAuth applications that user has authorized.

The check SHALL apply the same user filtering rules as the existing 2FA and employee-access
checks (organizational unit, suspended/archived state, include/exclude email terms), so that
collected grants are joinable to the organization members that employee sync creates.

The check SHALL emit one result row per distinct OAuth client rather than one row per
user-application pair.

#### Scenario: Collecting grants for an organization

- **WHEN** the check runs against a connection holding the required scope
- **THEN** one result row of resource type `oauth_app` is emitted per distinct OAuth client id
- **AND** each row's evidence carries the client id, display name, native/anonymous flags, a
  deduplicated scope catalogue, the grantee count, and the grantee list
- **AND** each grantee entry carries the member's email and Google user key

#### Scenario: An application with more grantees than one row may hold

- **WHEN** an application has more than 500 grantees
- **THEN** the grantee list is split across additional rows whose resource ids are suffixed
  `#2`, `#3` and so on
- **AND** every part records its own part number and the total part count
- **AND** no grantee is silently discarded

#### Scenario: A single user's grants cannot be read

- **WHEN** the directory API returns an error for one user
- **THEN** that user is counted as failed or denied according to the error class
- **AND** the run continues for all remaining users
- **AND** the failure does not cause the check to throw

#### Scenario: Grants are an inventory, not a violation

- **WHEN** a user has authorized any number of third-party applications
- **THEN** the emitted application rows are passing results
- **AND** no finding is raised on the basis of a person holding access

#### Scenario: Emails are not written to run logs

- **WHEN** the check logs progress
- **THEN** log output contains counts only
- **AND** no employee email address appears in the persisted run log

### Requirement: Inventory Run Marker

Every run of the third-party app inventory check SHALL emit exactly one marker row describing
the completeness of that run, so that downstream consumers can distinguish "nothing was
authorized" from "we could not see everything".

The marker SHALL be reported complete only when at least one user was inspected, no global
denial occurred, the proportion of failed and denied users did not exceed 20%, and no
application exceeded the maximum number of spill rows.

#### Scenario: A complete run

- **WHEN** every in-scope user was inspected successfully
- **THEN** a marker row of resource type `inventory` is emitted
- **AND** it reports completeness as true
- **AND** it records the users inspected, succeeded, failed and denied, the application count,
  the grant count, and the filters that were applied

#### Scenario: A partially degraded run

- **WHEN** more than 20% of in-scope users could not be read
- **THEN** the marker row reports completeness as false
- **AND** the counters still reflect what was collected

#### Scenario: A run that collected nothing

- **WHEN** the check inspects users and finds no authorized applications
- **THEN** the marker row is still emitted
- **AND** the run never stores zero result rows

### Requirement: Connection Scope Drift Detection

The integration platform SHALL expose, for any connection, which OAuth scopes were granted,
which are currently required, and which are missing, so that a connection whose consent predates
a scope addition can be identified rather than silently failing.

Where a connection's stored credentials predate scope persistence, the status SHALL be reported
as unknown rather than as missing.

#### Scenario: A connection missing a newly added scope

- **WHEN** scope status is requested for a connection whose granted scopes omit a required scope
- **THEN** the missing scope is reported
- **AND** the connection is marked as requiring reconnection

#### Scenario: A connection with no recorded scopes

- **WHEN** scope status is requested for a connection whose credentials carry no scope record
- **THEN** the status is reported as unknown
- **AND** the connection is not marked as requiring reconnection

#### Scenario: Surfacing reconnection to the user

- **WHEN** a connection requires reconnection
- **THEN** the integration detail view and the discovered-vendors view both display a
  reconnection prompt
- **AND** completing the standard authorization flow clears it without losing the refresh token

### Requirement: Consent-Blocked Runs Produce No Misleading Evidence

When the required scope has not been consented, the system SHALL NOT record a check run that
could be mistaken for a successful observation of zero grants.

#### Scenario: Scheduled discovery against a connection lacking consent

- **WHEN** the scheduled discovery task preflights a connection and finds the required scope
  missing
- **THEN** no check run is created
- **AND** the block reason and missing scopes are recorded on the connection metadata
- **AND** the most recent previously successful run remains the latest run for that check

#### Scenario: Manually running the check without consent

- **WHEN** a user manually runs the check on a connection lacking consent
- **THEN** the check emits a scope-consent finding carrying remediation guidance
- **AND** emits a run marker reporting completeness as false
- **AND** returns without throwing

#### Scenario: Detecting denial without exhausting quota

- **WHEN** the first five users inspected are all denied
- **THEN** the check stops issuing further per-user requests for that run
