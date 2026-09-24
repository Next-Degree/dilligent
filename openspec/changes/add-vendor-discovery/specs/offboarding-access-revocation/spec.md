# Offboarding Access Revocation — Delta

## MODIFIED Requirements

### Requirement: Access Revocation Checklist Contents

The offboarding access revocation checklist SHALL present the vendors a departing member
actually holds observed access to, rather than every vendor in the organization.

Where observed access data is unavailable — no discovery source is connected, or the most recent
observation was not trustworthy — the checklist SHALL fall back to presenting the full vendor
register rather than presenting an empty list, so that offboarding is never silently narrowed on
the basis of missing data.

The checklist SHALL always include vendors for which a revocation has already been recorded, so
that completed history remains visible, and SHALL allow a reviewer to add any other vendor from
the register.

#### Scenario: A member with observed access

- **WHEN** the checklist is requested for a member holding active grants
- **THEN** the vendors for those grants are presented
- **AND** vendors the member holds no grants for are not presented by default

#### Scenario: Revocations already recorded

- **WHEN** the member has a recorded revocation for a vendor they no longer hold a grant for
- **THEN** that vendor is still presented with its revocation history

#### Scenario: No observed access data available

- **WHEN** no trustworthy observation exists for the organization
- **THEN** the full vendor register is presented
- **AND** the absence of observation data is indicated

#### Scenario: Adding a vendor not observed

- **WHEN** a reviewer needs to revoke access to a vendor not in the presented list
- **THEN** they can add any vendor from the register to the checklist

#### Scenario: Provenance is visible

- **WHEN** a vendor appears because access was observed through an integration
- **THEN** the checklist indicates how that access was discovered

### Requirement: Recording a Revocation

Recording a revocation SHALL capture both the attested human action and the effect on observed
access state, and SHALL keep the two distinguishable.

#### Scenario: Revoking access to a vendor

- **WHEN** a reviewer records revocation of a member's access to a vendor
- **THEN** the attested revocation is recorded with its actor, timestamp, notes and any evidence
  attachment
- **AND** the member's observed grants for that vendor are marked withdrawn with reason
  "offboarding"
- **AND** both writes occur in a single transaction

#### Scenario: Attestation and observation remain separable

- **WHEN** an auditor reviews revocation history
- **THEN** access a person confirmed they removed is distinguishable from access that merely
  stopped being observed
