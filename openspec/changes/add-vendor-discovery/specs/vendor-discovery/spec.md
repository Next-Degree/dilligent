# Vendor Discovery — Delta

## ADDED Requirements

### Requirement: Discovered Vendor Candidates

The system SHALL maintain, per organization, a record of each third-party application observed
through an integration, identified by its external application id, and SHALL track that record
through a review lifecycle of pending, approved, or ignored.

A candidate SHALL record when it was first and last observed, how many members currently hold
access, and the union of scopes granted to it.

#### Scenario: A newly observed application

- **WHEN** an application is observed that has no existing candidate for the organization
- **THEN** a candidate is created with status pending
- **AND** its first-seen and last-seen timestamps are set to the observation time

#### Scenario: A previously observed application

- **WHEN** an application is observed that already has a candidate
- **THEN** the existing candidate is updated rather than duplicated
- **AND** its last-seen timestamp advances and its display name and scopes are refreshed

#### Scenario: An application that is no longer observed

- **WHEN** a trustworthy run no longer reports an application that previously had a candidate
- **AND** that candidate has no remaining active grants
- **THEN** the candidate is marked as disappeared at the run's collection time
- **AND** the candidate row is retained rather than deleted

#### Scenario: Candidates are scoped to their organization

- **WHEN** a candidate is requested by an actor from a different organization
- **THEN** the request does not disclose the candidate

### Requirement: Deterministic Vendor Resolution

The system SHALL attempt to resolve each discovered application to a known vendor using exact
matching on normalized names and domains, in a defined precedence order, before resorting to
inference.

Normalization SHALL remove case, diacritics, legal-entity suffixes, and sign-in boilerplate.
Matching SHALL NOT use fuzzy or partial name similarity.

#### Scenario: The application is already a vendor in the register

- **WHEN** a discovered application resolves to an existing vendor in that organization
- **THEN** the candidate is linked to that vendor and marked approved
- **AND** no new vendor is created

#### Scenario: The application is in the global vendor catalogue

- **WHEN** no organization vendor matches and the global catalogue contains an exact normalized
  match
- **THEN** the candidate records the catalogue's canonical website and the resolution method
- **AND** the candidate remains pending

#### Scenario: The application is a known integration

- **WHEN** neither prior tier matches and an active integration definition matches by normalized
  name
- **THEN** the candidate records the domain derived from that integration's base URL

#### Scenario: A near-miss must not match

- **WHEN** a discovered application's normalized name is similar to but not identical with a
  known vendor's
- **THEN** no link is established on the basis of that similarity

#### Scenario: An application with no usable identity

- **WHEN** a discovered application reports itself as anonymous or carries no display name
- **THEN** the candidate is recorded as unresolved
- **AND** it is not submitted for inferred resolution

#### Scenario: First-party platform applications

- **WHEN** a discovered application belongs to the identity provider's own first-party clients
- **THEN** the candidate is created with status ignored and a recorded reason
- **AND** it remains visible and can be reopened

### Requirement: Inferred Vendor Resolution Fallback

Where deterministic resolution fails, the system SHALL attempt inferred resolution, and SHALL
treat the result as a suggestion requiring human confirmation.

Inferred resolution SHALL be batched, SHALL run at most once per candidate unless its display
name changes, and SHALL NOT perform web research inline.

#### Scenario: Inferring a vendor for an unmatched application

- **WHEN** a candidate survives all deterministic tiers
- **THEN** it is submitted for inferred resolution in a batch with other unmatched candidates
- **AND** any suggested name, website, description and category are stored with the raw output
  retained as evidence

#### Scenario: Inference never decides

- **WHEN** inferred resolution returns a suggestion
- **THEN** the candidate remains pending
- **AND** its recorded confidence does not exceed the inference ceiling

### Requirement: Candidate Approval Creates a Vendor

Approving a candidate SHALL result in a vendor in the organization's register, marked as
originating from discovery, and SHALL be safe to attempt more than once.

#### Scenario: Approving an unresolved or catalogue-resolved candidate

- **WHEN** an authorized user approves a candidate that is not already linked to a vendor
- **THEN** a vendor is created through the standard vendor creation path
- **AND** the vendor records discovery as its source together with the discovery timestamp
- **AND** the candidate is marked approved and linked to the new vendor

#### Scenario: A vendor is never created without a description

- **WHEN** a vendor is created from a candidate
- **THEN** its description is taken from the first available of the catalogue description, the
  integration description, or the inferred description
- **AND** where none is available a generated description recording the discovery source, date
  and grantee count is used
- **AND** the description is never empty

#### Scenario: Approving twice

- **WHEN** approval is requested for a candidate that is already approved
- **THEN** no second vendor is created
- **AND** the operation succeeds without error

#### Scenario: Approval is attributable

- **WHEN** approval is requested by a caller for whom no acting user can be resolved
- **THEN** the request is rejected with a message explaining that an attributable user is
  required

#### Scenario: Approval does not overwhelm shared research capacity

- **WHEN** the discovered-vendors view is presented
- **THEN** no control is offered that approves multiple candidates in a single action

### Requirement: Ignoring and Reopening Candidates

An authorized user SHALL be able to remove a candidate from the review queue without losing the
access data associated with it, and SHALL be able to restore it later.

#### Scenario: Ignoring a candidate

- **WHEN** an authorized user ignores a candidate with a reason
- **THEN** the candidate leaves the pending queue and records the decision, actor and time
- **AND** its grants continue to be observed and updated

#### Scenario: Reopening a candidate

- **WHEN** an authorized user reopens an ignored candidate
- **THEN** it returns to the pending queue

### Requirement: Discovery Review Access Control

Access to discovered candidates SHALL be governed by the existing vendor permissions, since a
candidate is a prospective vendor and approving one creates a vendor.

#### Scenario: Reading the review queue

- **WHEN** an actor holding vendor read permission requests the queue
- **THEN** the candidates are returned

#### Scenario: Approving without create permission

- **WHEN** an actor lacking vendor create permission attempts approval
- **THEN** the request is refused

#### Scenario: Roles with no vendor permissions

- **WHEN** an actor holding only employee or contractor roles requests the queue
- **THEN** the request is refused

### Requirement: Reconciliation Safety

The system SHALL only infer that access has been withdrawn from evidence that is known to be
complete, and SHALL never interpret missing or degraded observations as withdrawal.

#### Scenario: Reconciling against a complete run

- **WHEN** the latest run's marker reports completeness, inspected at least one user, is within
  the freshness window, and carries no consent failure
- **THEN** both new observations and withdrawals are applied

#### Scenario: Reconciling against a degraded run

- **WHEN** the latest run's marker reports incomplete, is stale, or a consent failure is present
- **THEN** newly observed applications and grants are still recorded
- **AND** no access is marked as withdrawn
- **AND** the reason reconciliation was skipped is reported

#### Scenario: No observations at all

- **WHEN** no run results exist for the check
- **THEN** no candidate or grant is created, updated, or withdrawn

#### Scenario: A genuinely empty inventory

- **WHEN** a run marker reports completeness and inspected users but found no applications
- **THEN** withdrawal is applied, because the organization genuinely has no authorized
  applications
