# Data Source Registry

## Purpose

Describe every external data source we buy from or pull from as a first-class
record: what it costs, what fields it returns, how fast those fields decay,
which subjects it covers, how hard it is to integrate, and where it sits in
its evaluation lifecycle.

## ADDED Requirements

### Requirement: Source registration

The system SHALL maintain a registry entry for every external data source,
identified by a stable slug, recording its vendor, category, subject type, and
lifecycle status.

#### Scenario: Registering a new source

- **GIVEN** a platform admin with `dataSource:create`
- **WHEN** they register a source with a slug not already in the registry
- **THEN** the source is stored with lifecycle status `evaluating` and appears
  in the registry listing

#### Scenario: Slug collision is rejected

- **GIVEN** a source with slug `example-source` already exists
- **WHEN** a platform admin registers another source with that slug
- **THEN** the request is rejected and the existing source is unchanged

#### Scenario: Non-admin cannot register

- **GIVEN** a user without `dataSource:create`
- **WHEN** they attempt to register a source
- **THEN** the request is denied and no source is created

### Requirement: Declared metadata is seeded from a version-controlled catalog

The system SHALL populate declared source metadata from checked-in catalog
files, upserting by slug, so that changes to declared terms arrive through code
review.

#### Scenario: Catalog seed creates and updates

- **GIVEN** a catalog file for slug `example-source` declaring a per-record
  price of 40 cents
- **WHEN** the seed runs and the source does not exist
- **THEN** the source is created with that declared price
- **AND WHEN** the file is changed to 55 cents and the seed runs again
- **THEN** the declared price is updated to 55 cents

#### Scenario: Observed metrics survive a reseed

- **GIVEN** a source with observed metrics computed from telemetry
- **WHEN** the catalog seed runs for that source
- **THEN** declared metadata is replaced and every observed metric is unchanged

### Requirement: Cost model

The system SHALL record each source's cost model as one of per-record,
per-call, per-refresh, subscription, or credit bundle, with amounts stored as
integer minor currency units.

#### Scenario: Per-call source with a miss rate

- **GIVEN** a source priced per call at 40 cents that returns a match on 43%
  of calls
- **WHEN** its cost summary is requested
- **THEN** the declared cost per call is reported as 40 cents
- **AND** the observed cost per matched record is reported as 93 cents

#### Scenario: Recurring refresh cost is reported separately

- **GIVEN** a source whose records must be refreshed every 90 days at cost
- **WHEN** its cost summary is requested
- **THEN** the response reports first-acquisition cost and annualized refresh
  cost as distinct figures

### Requirement: Available fields

The system SHALL record the individual fields a source returns, each with a
data type and a PII classification.

#### Scenario: Listing fields for a source

- **GIVEN** a source declaring fields for current employer, job title, and
  work email
- **WHEN** the source's field list is requested
- **THEN** all three fields are returned with their data types and PII
  classifications

### Requirement: Per-field freshness policy

The system SHALL define a time-to-live and a decay profile per field rather
than per source, and SHALL classify each stored value as fresh, aging, stale,
or expired against its own field's policy.

#### Scenario: Fields of one source decay at different rates

- **GIVEN** a source whose job title field has a 90-day TTL and whose work
  email field has a 540-day TTL
- **WHEN** a record fetched 200 days ago is evaluated
- **THEN** the job title is reported `expired` and the work email `fresh`

#### Scenario: Append-only fields never expire

- **GIVEN** a field with decay profile `append_only`
- **WHEN** any amount of time passes since the fetch
- **THEN** the field is never reported `expired`, and the record is reported
  as potentially incomplete instead

### Requirement: Coverage definition

The system SHALL record, for each source, the population it claims to cover
and the identifier required to query it.

#### Scenario: Source requiring an identifier we may not hold

- **GIVEN** a source that can only be queried by a public professional profile
  URL
- **WHEN** its coverage definition is requested
- **THEN** the required identifier is reported
- **AND** the share of the reference cohort for which we hold that identifier
  is reported as its reachability ceiling

### Requirement: Technical complexity assessment

The system SHALL record a complexity assessment per source across auth
onboarding, throughput limits, schema volatility, backfill burden, entity
resolution difficulty, and operational model, with a derived effort band and a
confidence.

#### Scenario: High-value, high-effort source is visible as such

- **GIVEN** a source scored 5 for entity resolution difficulty and 4 for
  schema volatility
- **WHEN** its assessment is requested
- **THEN** an effort band of `L` or `XL` is reported alongside the individual
  dimension scores

### Requirement: Lifecycle decisions are recorded with an owner and review date

The system SHALL require a decider, a rationale, and a next review date on
every lifecycle status transition, and SHALL surface sources whose review date
has passed.

#### Scenario: Adopting a source

- **GIVEN** a source in `trial`
- **WHEN** a platform admin transitions it to `adopted` with a rationale and a
  review date six months out
- **THEN** the transition is stored with the deciding user, timestamp, and
  rationale

#### Scenario: Transition without a rationale is rejected

- **GIVEN** a source in `evaluating`
- **WHEN** a transition to `adopted` is submitted without a rationale
- **THEN** the request is rejected and the status is unchanged

#### Scenario: Overdue review is surfaced

- **GIVEN** an adopted source whose next review date has passed
- **WHEN** the registry listing is requested
- **THEN** the source is flagged as overdue for review
