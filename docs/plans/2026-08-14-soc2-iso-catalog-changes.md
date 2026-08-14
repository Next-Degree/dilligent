# SOC 2 + ISO 27001 Catalog Rebuild — Change Record

**Date:** 2026-08-14
**Branch:** `claude/soc2-controls-inventory-g4wq1x`
**Frameworks:** SOC 2 `frk_683f377429b8408d1c85f9bd`, ISO 27001 `frk_681ecc34e85064efdbb76993`
**Validation:** `bun run db:seed:validate` — 0 errors (30 documentTypes warnings, tracked below)

Implements Phases 0–1 of `2026-08-14-soc2-catalog-uplift.md`, extended to ISO
27001 per the expanded scope. SOC 2 audit scope is Security + Availability;
Confidentiality, Processing Integrity, and Privacy criteria are seeded and
mapped for future-proofing.

## What changed

### Data-quality repairs
- 51 requirement identifiers had stray whitespace/tabs (`"6.1.3 "`, `"\t A.8.9"`) — trimmed.
- SOC 2 `P3.2` existed as four identical requirement rows — merged into one.
- ISO `9.1.1`/`9.1.2` (a nonstandard split) — merged into a single `9.1`.
- Missing requirements added: SOC 2 `C1.2` (confidential disposal), ISO `6.2`
  (objectives), ISO `6.3` (planning of changes).

### Blanket mappings removed
Three ISO controls were linked to *every* ISO requirement (~119 each), and the
"Separation of Environments" task was linked to *every* SOC 2 control. All are
now scoped to their real subject matter:
- **Internal Audit & Management Review** → clauses 9.1–10.2 + A.5.35/A.8.34, and
  now cross-mapped to SOC 2 CC4.1/CC4.2 (control self-assessment).
- **Legal, Regulatory & IP Compliance** → clauses 4.1/4.2 + A.5.31–A.5.34.
- **Risk Management (ISO duplicate)** → retired; the SOC 2 Risk Management
  control now carries 6.1.1–6.1.3 and 8.1–8.3.
- **Separation of Environments** task → kept only on Secure SDLC Integration
  (its real home: A.8.31 / CC8.1).

### Retired control templates (rows kept, all framework links removed)
- **Endpoint Security** — folded into Endpoint Protection (CC6.6–CC6.8, C1.1).
- **Supplier & Third-Party Security** — folded into Supplier Security
  (now CC9.2 + A.5.19–A.5.23).
- **Risk Management** (ISO blanket duplicate `frk_ct_69e639b90a3bf8c1443cbf5b`).
- **Encrypted Data at Rest** duplicate (`frk_ct_68e8079750107bcc63fc79d9`) —
  superseded by `frk_ct_69e669af7fd9ef27754dc041`.

### New controls (9)
Board Oversight; System Description & Service Commitments; Customer
Communications & Support; Security Awareness Training; Authentication
Enforcement; Privileged & Production Access Restriction; Mobile Device
Management; Backup Management; Cybersecurity Insurance.

### New evidence tasks (11)
Vulnerability Scanning & Remediation (quarterly); Acceptable Use
Acknowledgment; System Patching Evidence (quarterly); Data Classification
Review; Remote Access Review (quarterly); Audit Log Configuration & Retention;
Operational Runbooks Review; Vendor Register & Risk Tiering (quarterly);
Status Page & Release Communications; Password Policy Configuration Evidence;
Cyber Insurance Policy Review.

Misplaced task links were moved to their proper homes (e.g. Static Code
Scanning off Data Retention onto SDLC/Vulnerability Management; Backup
Restoration Test off Incident Management onto Backup Management; the broadly
scattered "Encryption at Rest" task kept only on the two encryption controls).

## Rollout runbook (live platform)

1. **Drift check** — confirm no template edits were made via the Framework
   Editor UI since this JSON was exported; the seed upserts by id and will
   overwrite live template rows.
2. `bun run db:seed` — upserts templates and connects new relations.
3. `bun run db:seed:prune prune-2026-08-soc2-iso-uplift.json` — applies the
   removals the seed cannot (432 requirement links, 50 task links, 2 policy
   links, 4 dead requirement rows). Re-runnable; skips requirement deletes
   still referenced by org data.
4. `bun run db:seed:validate` — must report 0 errors against the live-exported
   state.
5. Platform admin → review **draft-diff** for both frameworks; publish new
   FrameworkVersions (suggested: SOC 2 `2.0.0`, ISO 27001 `2.0.0`) with release
   notes pointing at this document.
6. Sync our org's SOC 2 and ISO framework instances (rollback window applies);
   verify the control lists, evidence tasks, and requirement mappings render.

## Known follow-ups
- 30 controls have no `documentTypes` (validator warning): the 13-value
  `EvidenceFormType` enum lacks fits (insurance certificate, vendor register,
  scan report…). Extending the enum is a Prisma migration + UI labels —
  deferred to its own change.
- Control families (`FrameworkControlFamily`) for Vanta-style domain grouping —
  per-instance data, applied after version sync.
- Direct Risk↔Control relation — Phase 2 of the uplift plan.
- The GitHub Dependabot backlog (90 open alerts at last push) is now the first
  real work item under "Vulnerability Scanning & Remediation".

## Expert-review revisions (same day, second pass)

Two independent expert reviews (SOC 2 all-TSC practitioner; ISO 27001:2022
lead auditor) were run against the rebuilt catalog. All accepted findings are
applied; the catalog is now 51 controls. Highlights:

**SOC 2 fixes:** CC5.2 re-homed from Disciplinary process to the ITGC controls
(Change management, Privileged & Production Access, Configuration & Patch);
CC1.1 now carried by Acceptable Use + Disciplinary process + a Code of Conduct
Acknowledgment task; CC2.1 backed by Security Monitoring and Internal
Audit/Management Review; CC1.2 left to Board Oversight alone; CC3.1 adds
System Description; CC5.1 adds Risk Management (risk-to-control selection) and
drops Acceptable Use; CC9.1 adds Business Continuity; the Risk Analysis task
was rewritten to require fraud scenarios and change-triggered reassessment
(CC3.3/CC3.4); a per-leaver offboarding evidence task covers timely
deprovisioning (CC6.2); Change management gains a sampled change-approval
task (CC8.1 operating effectiveness).

**ISO fixes:** A.5.5/A.5.6 get a real Authority & Special-Interest Contact
Register task (the customer Contact task moved to Customer Communications);
A.5.7 gets a Threat Intelligence Review task; A.8.12 moved off Data Masking
onto Security Monitoring with a Data Egress & DLP task; the SDLC lump split
into three controls — Secure Development Lifecycle (A.5.8, A.8.25, A.8.27 +
threat-model evidence), Secure Coding & Testing (A.8.26, A.8.28, A.8.29), and
Development Environment & Test Data (A.8.31, A.8.33 + test-data controls);
A.8.30 moved to Supplier Security; clause 6.3 re-homed from IT change
management to Internal Audit & Management Review (ISMS change planning);
clauses 4.1/4.2 re-homed from Legal to Policy Compliance; the Legal control
gains obligations-register and license-compliance tasks (A.5.31/A.5.32) and
A.5.33 moved to Data Retention; A.5.17/A.8.5 disambiguated between Credential
Management and Authentication Enforcement (duplicate 2FA evidence removed);
A.8.17 moved to Security Logging; A.8.18 kept only on Privileged Utility
Programs (renamed from "Utility Tool monitoring"); physical-control overlaps
(A.7.9/A.7.10/A.7.14) resolved to their primary homes; a Corrective Action
Register task added for clauses 10.1/10.2; HR merged into a single Personnel
Security control with offboarding/NDA/code-of-conduct evidence; five
HIPAA-worded tasks rewritten framework-neutral; two more stale duplicates
retired (second "Physical & Environmental Security"; the demo "Fridge" control
lost its stray 2FA link).

**Documented decisions:**
- Clause rows (4.x–10.x) stay mapped to catalog controls for in-app
  completeness, but the ISMS document module is the authoritative source for
  clause-level documented information; control-side clause evidence is
  supplementary.
- PI1.3/PI1.4 remain on Change management / Access Rights as acknowledged
  placeholders until dedicated Processing Integrity controls are built
  (documented as out of audit scope).
- SoA generation gaps (no FK from SoA questions to requirements, no
  implementation-status field, 2013-era example numbering in the schema
  comment) are deferred to Phase 2 app work alongside the Risk-Control
  relation.

## Resulting catalog (51 controls, post-review)

| Control | SOC 2 | ISO 27001:2022 | Evidence tasks |
| --- | --- | --- | --- |
| Acceptable Use | C1.1, CC1.1, CC2.2 | A.5.10 | Acceptable Use Acknowledgment |
| Access Rights | CC6.1, CC6.2, CC6.3, PI1.4, PI1.5 | A.5.15, A.5.16, A.5.18 | Employee Access; Access Review Log; Offboarding Checklist: Access & Asset Return |
| Asset Inventory | CC6.1 | A.5.9 | Device List; Infrastructure Inventory |
| Authentication Enforcement | CC6.1, CC6.6 | A.8.5 | 2FA; Password Policy Configuration Evidence |
| Backup Management | A1.2 | A.8.13 | Backup logs; Backup Restoration Test |
| Board Oversight | CC1.2 | 5.1 | Board Meetings & Independence |
| Business Continuity & ICT Readiness | A1.2, A1.3, CC9.1 | A.5.29, A.5.30 | Contingency Plan Testing & Revision |
| Change management | CC5.2, CC8.1, PI1.3, PI1.4 | A.8.32 | Code Changes; Change Approval Samples |
| Configuration & Patch Management | CC5.2, CC6.8, CC7.1 | A.8.9, A.8.19 | System Patching Evidence; Hardening Baseline & Configuration Review |
| Credential Management | CC6.1 | A.5.17 | Secure Secrets |
| Customer Communications & Support | CC2.3, PI1.1 | — | Status Page & Release Communications; Contact Information |
| Cybersecurity Insurance | CC9.1 | — | Cyber Insurance Policy Review |
| Data Masking | — | A.8.11 | Data Masking |
| Data Privacy | P1.1, P2.1, P3.1, P3.2, P4.1, P4.2, P4.3, P5.1, P5.2, P6.1, P6.2, P6.3, P6.4, P6.5, P6.6, P6.7, P7.1, P8.1 | A.5.34 | Public Policies |
| Data Retention & Destruction | C1.2, CC6.5 | A.5.33, A.7.10, A.7.14, A.8.10 | Media Sanitization & Disposal Log; Customer Data Deletion Evidence |
| Development Environment & Test Data | — | A.8.31, A.8.33 | Separation of Environments; Test Data Controls |
| Disaster Recovery Planning | A1.2, A1.3, CC7.5 | A.8.14 | Planning; App Availability |
| Disciplinary process | CC1.1, CC1.5 | A.6.4 | Employee Descriptions; Sanction Policy |
| Encrypted Data at Rest | C1.1, CC6.1 | A.8.24 | Encryption at Rest |
| Encryption Key Management | CC6.1, CC6.7 | A.8.24 | Secure Secrets; Encryption at Rest |
| Endpoint Protection | C1.1, CC6.6, CC6.7, CC6.8 | A.8.1, A.8.7, A.8.19 | Secure Devices |
| Information Classification | C1.1 | A.5.12, A.5.13 | Data Classification Review |
| Internal Audit & Management Review | CC2.1, CC4.1, CC4.2 | 6.3, 9.1, 9.2, 9.3, 10.1, 10.2, A.5.35, A.8.34 | Internal Security Audit; Management Review Minutes; Corrective Action Register |
| Legal, Regulatory & IP Compliance | — | A.5.31, A.5.32 | Legal Proof of Company Registration; Legal & Regulatory Obligations Register; Software License Compliance |
| Management Security Accountability | CC1.3 | 5.1, 6.2, 7.1, A.5.4 | Management Review Minutes |
| Mobile Device Management | CC6.7 | A.7.9, A.8.1 | Device List; Secure Devices |
| Network Security | CC6.1, CC6.6 | A.8.20, A.8.21, A.8.22, A.8.23 | Production Firewall & No-Public-Access Controls; Diagramming |
| Organization Structure & Reporting Lines | CC1.3 | 5.3 | Organisation Chart |
| Personnel Security | CC1.1, CC1.4, CC1.5 | A.5.11, A.6.1, A.6.2, A.6.5, A.6.6 | Employee Verification; Employee Performance Evaluations; Offboarding Checklist: Access & Asset Return; Confidentiality & NDA Agreements; Code of Conduct Acknowledgment |
| Physical & Environmental Security | A1.2 | A.7.5, A.7.6, A.7.7, A.7.8, A.7.11, A.7.12, A.7.13 | Facility Security Plan |
| Physical Access Control | CC6.4 | A.7.1, A.7.2, A.7.3, A.7.4 | Building / Workplace Rules; Visitor Control; Office Access & Door Monitoring; Secure Storage |
| Policy Compliance | CC2.1, CC2.2, CC5.3 | 4.1, 4.2, 4.3, 4.4, 5.2, 7.4, 7.5.1, 7.5.2, 7.5.3, A.5.1, A.5.36 | Policy Documentation & Retention; Public Policies |
| Privileged & Production Access Restriction | CC5.2, CC6.1, CC6.2, CC6.3 | A.8.2, A.8.3, A.8.4 | Role-based Access Controls; Access Review Log |
| Privileged Utility Programs | — | A.8.18 | Utility Monitoring |
| Regulatory Liaison | CC2.3 | A.5.5, A.5.6 | Authority & Special-Interest Contact Register |
| Remote-Work Security | CC6.6, CC6.7 | A.6.7 | Remote Access Review |
| Resource Capacity Management | A1.1 | A.8.6 | App Availability |
| Risk Management | CC3.1, CC3.2, CC3.3, CC3.4, CC5.1, CC9.1 | 6.1.1, 6.1.2, 6.1.3, 8.1, 8.2, 8.3 | Risk Analysis & Treatment Plan |
| Secure Coding & Testing | CC8.1, PI1.2 | A.8.26, A.8.28, A.8.29 | Sanitized Inputs; Secure Code; Static Code Scanning |
| Secure Data Transfer | C1.1, CC6.7, PI1.5 | A.5.14 | TLS / HTTPS |
| Secure Development Lifecycle | PI1.1 | A.5.8, A.8.25, A.8.27 | Secure Design & Threat Model Review |
| Security Awareness Training | CC1.4, CC2.2 | 7.2, 7.3, A.6.3 | Security Awareness Training |
| Security Governance Roles | CC1.3 | 5.3, A.5.2 | Security Officer Assignment |
| Security Incident Management | CC7.3, CC7.4, CC7.5 | A.5.24, A.5.25, A.5.26, A.5.27, A.5.28, A.6.8 | Incident Response; Annual Incident Response Tabletop Exercise |
| Security Logging | CC7.2 | A.8.15, A.8.17 | Audit Log Configuration & Retention |
| Security Monitoring & Detection | CC2.1, CC7.2, CC7.3 | A.5.7, A.8.12, A.8.16 | Monitoring & Alerting; Threat Intelligence Review; Data Egress & DLP Controls |
| Segregation of duties | CC5.1 | A.5.3 | Role-based Access Controls |
| Standard Operating Procedures (SOPs) | CC5.1, CC5.3 | A.5.37 | Operational Runbooks Review |
| Supplier Security | CC9.2 | A.5.19, A.5.20, A.5.21, A.5.22, A.5.23, A.8.30 | Supplier Evaluation Records; Vendor Register & Risk Tiering |
| System Description & Service Commitments | CC2.3, CC3.1 | — | Systems Description |
| Vulnerability Management | CC7.1 | A.8.8 | Vulnerability Scanning & Remediation; Static Code Scanning |

Total: 51 controls
