# Data Source Comparison

## Purpose

Give the team one platform-admin surface that answers "which source should we
buy, keep, or drop" — a source-by-dimension matrix, per-source scorecards
showing declared against observed, a stage-scoped signal view, and the ranked
list of demand we cannot serve.

## ADDED Requirements

### Requirement: Comparison matrix

The system SHALL present a matrix of registered sources against cost,
freshness, coverage, available fields, signal type, signal strength,
technical complexity, ongoing enrichment cost, and compliance risk.

#### Scenario: Comparing sources side by side

- **GIVEN** several registered sources
- **WHEN** a platform admin opens the comparison matrix
- **THEN** each source is a row and each evaluation dimension is a column

#### Scenario: Missing data is shown as missing

- **GIVEN** a source with no coverage measurement yet
- **WHEN** it is displayed in the matrix
- **THEN** its coverage cell reads as not yet measured and is not rendered as
  zero

### Requirement: Declared and observed values are shown together

The system SHALL display the declared and observed value for every dimension
that has both, and SHALL highlight where they diverge beyond a configured
threshold.

#### Scenario: Divergence is highlighted

- **GIVEN** a source declaring 90% coverage whose observed coverage is 48%
- **WHEN** its scorecard is displayed
- **THEN** both values are shown together and the divergence is highlighted

### Requirement: Comparison is filterable by stage

The system SHALL allow the comparison to be scoped to the search stage or the
prospect stage, showing only signals and costs applicable to that stage.

#### Scenario: Scoping to the search stage

- **GIVEN** sources with a mix of search-stage and prospect-stage signals
- **WHEN** the comparison is scoped to the search stage
- **THEN** only search-applicable signals and their per-population costs are
  shown

### Requirement: Weighted scoring with editable, versioned weights

The system SHALL compute a weighted score per source per stage using weights
that platform admins can edit, and SHALL retain the weight version used for
each computed score.

#### Scenario: Adjusting weights re-ranks sources

- **GIVEN** a scored set of sources
- **WHEN** a platform admin increases the weight on cost and recomputes
- **THEN** the ranking updates and the new weight version is recorded

#### Scenario: A ranking change is attributable

- **GIVEN** two rankings computed at different times
- **WHEN** they are compared
- **THEN** the weight version for each is shown, so a change in weights is
  distinguishable from a change in the underlying data

### Requirement: Unmet demand view

The system SHALL present the ranked list of requested-but-unserved attributes
alongside any registered source that could supply them.

#### Scenario: Acquisition candidate is surfaced

- **GIVEN** an unserved attribute requested frequently, provided by a
  registered source in `evaluating` status
- **WHEN** the unmet demand view is opened
- **THEN** the attribute is listed with its request volume and that source is
  shown as a candidate

### Requirement: Comparison is exportable

The system SHALL export the comparison, including declared and observed values
and the weight version, in a machine-readable format.

#### Scenario: Exporting for offline review

- **GIVEN** a scoped comparison
- **WHEN** a platform admin exports it
- **THEN** the export contains every displayed dimension, both declared and
  observed values, and the weight version used

### Requirement: Access is restricted to platform admins

The system SHALL restrict every comparison surface and its underlying
endpoints to platform administrators, and SHALL record access in the admin
audit log.

#### Scenario: Non-admin is denied

- **GIVEN** an authenticated user who is not a platform admin
- **WHEN** they request a comparison endpoint
- **THEN** the request is denied

#### Scenario: Unauthenticated request is denied

- **GIVEN** an unauthenticated request
- **WHEN** it reaches a comparison endpoint
- **THEN** it is denied

#### Scenario: Access is audited

- **GIVEN** a platform admin viewing the comparison
- **WHEN** the request completes
- **THEN** an admin audit log entry is recorded

### Requirement: Existing admin integration views link to evaluation records

The system SHALL link a source shown in the existing platform-admin
integrations view to its evaluation record where one exists.

#### Scenario: Navigating from credentials to evaluation

- **GIVEN** an integration in the admin integrations view with a registered
  source of the same slug
- **WHEN** a platform admin views that integration
- **THEN** a link to its evaluation record is shown
