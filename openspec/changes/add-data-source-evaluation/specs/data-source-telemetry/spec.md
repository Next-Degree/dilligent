# Data Source Telemetry

## Purpose

Measure what sources actually do in production — field-level provenance, real
cost, real freshness, real coverage — and capture what customers search for
that we cannot answer, so source selection is driven by evidence rather than
advocacy.

## ADDED Requirements

### Requirement: Field-level provenance

The system SHALL record, for every stored field value, the source it came
from, when it was fetched, what it cost, the license terms in force at fetch,
the confidence, and the acquiring organization.

#### Scenario: One subject assembled from several sources

- **GIVEN** a subject whose employer came from source A and whose email came
  from source B
- **WHEN** provenance for that subject is requested
- **THEN** each field is returned with its own source, fetch time, cost, and
  license reference

#### Scenario: Pre-existing data without provenance

- **GIVEN** a value stored before provenance recording existed
- **WHEN** its provenance is requested
- **THEN** the provenance is reported as unknown rather than attributed to any
  source

### Requirement: Usage events

The system SHALL record every call to a source with its outcome, latency,
cost, and stage.

#### Scenario: A miss is recorded as a paid call

- **GIVEN** a source that charges per call and returns no match
- **WHEN** the call completes
- **THEN** a usage event is recorded with outcome `miss` and the incurred cost

#### Scenario: Rate limiting is distinguished from a miss

- **GIVEN** a source that rejects a call for exceeding a rate limit
- **WHEN** the call completes
- **THEN** the outcome is recorded as `rate_limited` and excluded from match
  rate calculations

### Requirement: Observed cost is derived from usage

The system SHALL compute observed cost per call, per matched record, and per
useful signal from recorded usage events, and SHALL report each alongside the
declared cost.

#### Scenario: Observed cost diverges from declared

- **GIVEN** a source declared at 40 cents per call with a 43% match rate
- **WHEN** its cost metrics are requested
- **THEN** declared cost per call, observed cost per call, and observed cost
  per matched record are all returned

### Requirement: Observed freshness distribution

The system SHALL compute the age of values at the time they are read, and
report median and 95th-percentile age together with the share served while
stale, per source and per field.

#### Scenario: A source is fresh on average but has a stale tail

- **GIVEN** a source whose values have a median read age of 11 days and a
  95th-percentile age of 240 days
- **WHEN** its freshness metrics are requested
- **THEN** both figures are returned, along with the share of reads served
  past the field's TTL

### Requirement: Coverage is measured against a reference cohort

The system SHALL compute reachability, match rate, field completeness, and
sampled accuracy against a maintained reference cohort rather than against
live traffic.

#### Scenario: Four coverage figures are reported separately

- **GIVEN** a source evaluated against the reference cohort
- **WHEN** its coverage is requested
- **THEN** reachability, match rate, completeness, and accuracy are returned
  as distinct figures

#### Scenario: Reachability ceiling from a missing identifier

- **GIVEN** a source queryable only by an identifier we hold for 55% of the
  cohort
- **WHEN** its coverage is requested
- **THEN** reachability is reported as 55%
- **AND** match rate is reported as a share of reachable subjects, not of the
  whole cohort

### Requirement: Coverage is sliced by segment

The system SHALL report every coverage figure broken down by segment, and
SHALL flag a source whose coverage varies across segments beyond a configured
threshold.

#### Scenario: Coverage concentrated in one segment

- **GIVEN** a source matching 88% of one seniority segment and 21% of another
- **WHEN** its coverage is requested
- **THEN** both segment figures are returned
- **AND** the source is flagged as having uneven coverage

### Requirement: Search demand capture

The system SHALL record the attributes customers filter on and whether each
filter could be served.

#### Scenario: An unserved filter is recorded

- **GIVEN** a customer filtering on an attribute no adopted source provides
- **WHEN** the search runs
- **THEN** a demand event is recorded marking that attribute unserved

### Requirement: Unmet demand is ranked

The system SHALL produce a ranking of attributes that were requested but could
not be served, ordered by request volume and distinct requesting organizations.

#### Scenario: Ranking guides acquisition

- **GIVEN** recorded demand events across several organizations
- **WHEN** the unmet demand ranking is requested
- **THEN** unserved attributes are returned ordered by volume, each with its
  distinct-organization count
- **AND** each is annotated with any registered non-adopted source that
  provides it

### Requirement: Metrics carry a resolution confidence

The system SHALL report the entity-resolution confidence underlying every
observed metric.

#### Scenario: Metrics over weakly resolved subjects

- **GIVEN** coverage computed over subjects resolved with low confidence
- **WHEN** the metric is requested
- **THEN** the metric is returned with a low resolution-confidence band

### Requirement: Metrics are precomputed

The system SHALL serve observed metrics from scheduled rollups rather than
aggregating raw events on request, and SHALL report the time each rollup was
computed.

#### Scenario: Stale rollup is visible

- **GIVEN** a rollup last computed 30 hours ago
- **WHEN** the metrics are requested
- **THEN** the metrics are returned with their computation timestamp
