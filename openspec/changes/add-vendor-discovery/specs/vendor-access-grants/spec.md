# Vendor Access Grants — Delta

## ADDED Requirements

### Requirement: Per-Person Vendor Access Records

The system SHALL maintain a record of which organization members hold access to which vendors,
distinct from the record of access having been revoked, so that "who can reach this vendor" is
answerable directly rather than inferred.

A grant SHALL be identified by the combination of organization, member, source, and external
application id — not by vendor — so that it can be recorded before any vendor exists.

Each grant SHALL record the scopes granted, when it was first and last observed, and, once
withdrawn, when and why.

#### Scenario: Recording observed access

- **WHEN** a trustworthy run reports that a member has authorized an application
- **THEN** a grant is recorded for that member and application
- **AND** its first-seen and last-seen timestamps are set

#### Scenario: Access observed again

- **WHEN** the same member and application are observed in a later run
- **THEN** the existing grant is updated rather than duplicated
- **AND** its last-seen timestamp and scopes are refreshed

#### Scenario: Manual grants do not collide

- **WHEN** access is recorded manually rather than observed
- **THEN** it carries a manual source and a non-null application identifier
- **AND** duplicate manual grants for the same member and vendor are prevented

### Requirement: Member Matching

The system SHALL attribute observed access to organization members deterministically, preferring
the provider's stable user identifier over email address, and SHALL report rather than discard
grantees it cannot attribute.

#### Scenario: Matching by provider identifier

- **WHEN** a grantee's provider user key matches a member's recorded external user id
- **THEN** the grant is attributed to that member

#### Scenario: Matching by email

- **WHEN** no provider identifier matches and the grantee's email matches a member's email
  case-insensitively
- **THEN** the grant is attributed to that member

#### Scenario: A grantee who is not a member

- **WHEN** a grantee matches no member
- **THEN** no grant is created for them
- **AND** they are included in the count of unmatched grantees returned by the run

### Requirement: Grants Survive Candidate Approval

A grant SHALL retain its identity and history when its application is approved into a vendor.

#### Scenario: Approving a candidate with existing grants

- **WHEN** a candidate holding grants is approved
- **THEN** every grant for that candidate is associated with the resulting vendor
- **AND** first-seen timestamps are preserved
- **AND** the grants remain associated with the candidate as well as the vendor

#### Scenario: Deleting a candidate

- **WHEN** a candidate is deleted
- **THEN** its grants are retained with the candidate association cleared
- **AND** the history of who held access is not lost

### Requirement: Withdrawal Detection

The system SHALL mark access as withdrawn when a complete observation no longer reports it, and
SHALL distinguish access that merely stopped being observed from access a person confirmed they
removed.

#### Scenario: Access no longer observed

- **WHEN** a trustworthy run does not report a grant that was previously active
- **THEN** that grant is marked withdrawn at the run's collection time with reason
  "not observed"
- **AND** the grant row is retained rather than deleted

#### Scenario: Access reappearing after being unobserved

- **WHEN** a grant withdrawn as "not observed" is observed again
- **THEN** it is restored to active

#### Scenario: Access reappearing after offboarding revocation

- **WHEN** a grant withdrawn with reason "offboarding" is observed again
- **THEN** it remains withdrawn
- **AND** its reappearance is recorded so it can be surfaced as a finding

#### Scenario: Withdrawal is never inferred from degraded evidence

- **WHEN** the run producing the observation is not trustworthy
- **THEN** no grant is marked withdrawn

### Requirement: Access Is Readable Per Vendor and Per Person

The system SHALL expose observed access from both directions, so that a reviewer can ask who
holds access to a vendor and what a given person can reach.

#### Scenario: Reading a vendor's grantees

- **WHEN** an actor holding vendor read permission requests a vendor's access list
- **THEN** the members holding active grants are returned with their scopes and observation
  timestamps

#### Scenario: Reading a person's access

- **WHEN** an authorized actor requests a member's vendor access
- **THEN** the vendors and applications that member holds grants for are returned
- **AND** withdrawn grants are distinguishable from active ones

#### Scenario: Presenting access without implying recency of use

- **WHEN** observed access is presented in the interface
- **THEN** it is described as access having been authorized
- **AND** it is not described as recently used, since no last-used signal is available
