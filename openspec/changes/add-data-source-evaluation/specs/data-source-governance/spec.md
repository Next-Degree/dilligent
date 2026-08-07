# Data Source Governance

## Purpose

Encode the contractual and regulatory terms attached to each source — licensed
use, cross-tenant reuse, derived-data rights, retention, deletion propagation,
and jurisdiction — and enforce the reuse rule at read time rather than
documenting it and hoping.

## ADDED Requirements

### Requirement: License terms are recorded per source

The system SHALL record, for every source, its licensed use scope,
cross-tenant reuse rule, derived-data rights, maximum retention, deletion
propagation mode, attribution requirement, permitted jurisdictions, and
whether adjudicative use is allowed, together with who reviewed the terms and
when.

#### Scenario: Recording terms

- **GIVEN** a platform admin with `dataSource:update`
- **WHEN** they record license terms for a source
- **THEN** the terms are stored with the reviewing user and a review timestamp

#### Scenario: Unreviewed source is visible as a gap

- **GIVEN** a registered source with no license terms recorded
- **WHEN** the governance listing is requested
- **THEN** the source is reported as unreviewed

### Requirement: License terms are snapshotted at fetch time

The system SHALL bind every fetched value to the license terms in force at the
moment of fetch, and SHALL continue to govern that value by those terms after
the source's terms change.

#### Scenario: Terms tighten after data was acquired

- **GIVEN** a value fetched while cross-tenant reuse was `permitted`
- **WHEN** the source's terms are later changed to `prohibited`
- **THEN** the previously fetched value remains governed by the permitted terms
- **AND** values fetched after the change are governed by the prohibited terms

### Requirement: Cross-tenant reuse is enforced on read

The system SHALL evaluate the cross-tenant reuse rule attached to each value
against the requesting organization before returning that value.

#### Scenario: Prohibited reuse is denied

- **GIVEN** a value fetched for organization A from a source whose terms
  prohibit cross-tenant reuse
- **WHEN** organization B requests that value
- **THEN** the value is not returned and the denial is logged

#### Scenario: Derived-only reuse withholds the raw value

- **GIVEN** a value from a source whose reuse rule is `derived_only`
- **WHEN** an organization other than the acquiring one requests it
- **THEN** the raw value is withheld
- **AND** signals derived from it are returned

#### Scenario: Aggregate-only reuse withholds subject-level data

- **GIVEN** values from a source whose reuse rule is `aggregate_only`
- **WHEN** another organization requests subject-level data
- **THEN** no subject-level value is returned
- **AND** the values still contribute to cohort-level metrics

#### Scenario: Acquiring organization is unaffected

- **GIVEN** a value fetched for organization A under any reuse rule
- **WHEN** organization A requests that value
- **THEN** the value is returned

### Requirement: Enforcement ships in shadow mode before denying

The system SHALL support a shadow mode in which reuse decisions are evaluated
and logged without withholding data, and an enforcing mode in which they are
applied.

#### Scenario: Shadow mode logs without denying

- **GIVEN** enforcement is in shadow mode
- **WHEN** a request would be denied under the reuse rule
- **THEN** the value is returned
- **AND** the would-be denial is logged

#### Scenario: Enforcing mode applies the decision

- **GIVEN** enforcement is in enforcing mode
- **WHEN** a request would be denied under the reuse rule
- **THEN** the value is withheld

### Requirement: Missing license terms deny under enforcement

The system SHALL treat a value whose source has no recorded license terms as
prohibited for cross-tenant reuse when enforcement is enabled.

#### Scenario: Newly added source without terms

- **GIVEN** enforcement is enabled and a source has no license terms recorded
- **WHEN** an organization other than the acquiring one requests a value from
  it
- **THEN** the value is withheld and the missing terms are reported as the
  reason

### Requirement: Adjudicative use is gated separately

The system SHALL block use of a source's data in an adverse decision about a
person unless that source is marked as permitting adjudicative use.

#### Scenario: Source not cleared for adjudicative use

- **GIVEN** a source marked as not permitting adjudicative use
- **WHEN** its data is requested in an adjudicative context
- **THEN** the request is denied and the denial is logged

### Requirement: Retention ceiling and deletion propagation are enforceable

The system SHALL identify values held beyond their source's maximum retention,
and SHALL identify values requiring propagation when a subject deletion
request is received.

#### Scenario: Value past its retention ceiling

- **GIVEN** a value from a source with a 365-day retention ceiling, fetched
  400 days ago
- **WHEN** the retention report is generated
- **THEN** that value is listed as over-retained

#### Scenario: Deletion request fans out by source

- **GIVEN** a subject with values from three sources, two of which require
  deletion propagation
- **WHEN** a deletion request is received for that subject
- **THEN** propagation obligations are reported for exactly those two sources
