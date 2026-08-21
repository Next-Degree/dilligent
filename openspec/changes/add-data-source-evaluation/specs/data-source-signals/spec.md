# Data Source Signals

## Purpose

Model the decision-relevant assertions we derive from source fields —
separately from the sources themselves — so that signal value, signal type,
and the stage at which a signal pays for itself can be compared across sources.

## ADDED Requirements

### Requirement: Signals are modeled independently of sources

The system SHALL represent a signal as its own entity, bound to the sources
and fields that can produce it, so that one source may produce many signals
and one signal may be produced by many sources.

#### Scenario: One signal from several sources

- **GIVEN** a signal that can be produced by either of two sources
- **WHEN** the signal is requested
- **THEN** both source bindings are returned, each with the fields it consumes

#### Scenario: Precedence when several sources can produce a signal

- **GIVEN** a signal bound to two sources with different precedence values
- **WHEN** both sources hold a value for the same subject
- **THEN** the value from the higher-precedence source is reported as
  authoritative and the other is retained as corroborating

### Requirement: Signal type classification

The system SHALL classify each signal as a strong positive, a strong negative,
an indirect filter, or context only.

#### Scenario: Strong negative is distinguished from an indirect filter

- **GIVEN** one signal classified `strong_negative` and another classified
  `indirect_filter`
- **WHEN** the signal catalog is listed
- **THEN** each is returned with its own classification and they are not
  aggregated into a single relevance number

### Requirement: Signal strength records declared and observed values distinctly

The system SHALL record a declared strength band from 1 to 5 and, separately,
an observed likelihood ratio with its sample size, and SHALL never present a
declared band as if it were measured.

#### Scenario: No outcome data yet

- **GIVEN** a signal with a declared strength band of 4 and no observed
  outcomes
- **WHEN** its strength is requested
- **THEN** the declared band is returned marked as an estimate
- **AND** the observed likelihood ratio is returned as null

#### Scenario: Observed strength contradicts the estimate

- **GIVEN** a signal with a declared band of 5 and an observed likelihood
  ratio near 1.0 over a sample of 4,000 subjects
- **WHEN** its strength is requested
- **THEN** both values are returned together with the sample size
- **AND** the discrepancy is flagged

#### Scenario: Sample too small to report

- **GIVEN** a signal whose observed likelihood ratio rests on fewer subjects
  than the configured minimum sample size
- **WHEN** its strength is requested
- **THEN** the observed value is returned marked as insufficiently powered

### Requirement: Stage applicability

The system SHALL record, per signal, whether it applies at the search stage,
the prospect stage, or both, and SHALL store its cost and value figures per
stage.

#### Scenario: Signal viable only after shortlisting

- **GIVEN** a signal produced by a per-call source costing 2.50 USD per subject
- **WHEN** its stage applicability is requested
- **THEN** it is reported as applicable at the prospect stage
- **AND** it is reported as not applicable at the search stage, with
  per-population cost given as the reason

#### Scenario: Search-stage signal requires precomputation

- **GIVEN** a signal marked applicable at the search stage
- **WHEN** the signal is saved
- **THEN** the system requires a precomputation and reindex cadence
- **AND** rejects the signal if none is given

### Requirement: ROI is only comparable within a stage

The system SHALL compute an ROI score per signal per stage and SHALL NOT rank
signals of different stages against one another.

#### Scenario: Ranking is scoped to a stage

- **GIVEN** signals applicable at different stages
- **WHEN** a ranked list is requested without a stage
- **THEN** the request is rejected as ambiguous
- **AND WHEN** a stage is supplied
- **THEN** only signals applicable at that stage are ranked

#### Scenario: ROI reflects coverage, not just strength

- **GIVEN** two signals at the same stage with equal strength and cost, one
  applying to 80% of the cohort and one to 15%
- **WHEN** they are ranked
- **THEN** the signal with the higher coverage ranks above the other

### Requirement: Every signal declares its outcome definition

The system SHALL require an explicit outcome definition on each signal,
stating what the signal predicts, before any strength value may be recorded.

#### Scenario: Strength without an outcome definition is rejected

- **GIVEN** a signal with no outcome definition
- **WHEN** a strength value is submitted for it
- **THEN** the request is rejected
