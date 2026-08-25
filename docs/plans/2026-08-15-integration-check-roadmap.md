# Integration Check Roadmap

**Status:** Analysis — no code changes
**Date:** 2026-08-15
**Branch:** `claude/soc2-controls-inventory-g4wq1x`
**Companion docs:** `2026-08-14-soc2-catalog-uplift.md` (plan), `2026-08-14-soc2-iso-catalog-changes.md` (catalog change record)

Which automated checks to build, for the tools Next Degree actually uses, to
close the evidence-automation gap in the rebuilt SOC 2 + ISO 27001 catalog.

## Baseline

After the catalog rebuild:

| Metric | Value |
| --- | --- |
| Controls in scope (SOC 2 + ISO 27001) | 51 |
| Distinct evidence tasks | 75 |
| Tasks with **no** automated check | **61 (81%)** |
| Controls with at least one automated check | 16 of 51 |
| Integration checks that exist today | 45, across 8 providers |

Existing coverage is concentrated in cloud infrastructure (AWS 9, Azure 14,
GCP 9) plus GitHub 5, Aikido 3, Google Workspace 2, Vercel 2, Linear 1. The
governance, people, vendor, and physical domains are almost entirely manual.

Adding integrations does **not** require shipping code: `DynamicIntegration`
(see `packages/db/prisma/schema/dynamic-integration.prisma`) stores manifests
and declarative checks as database rows, explicitly "without code changes or
deployments." Hand-written TypeScript manifests remain an option where a check
needs real logic.

## Build check *patterns* before check *integrations*

A GRC Tools catalog export for 13 integrations (89 tests total) shows that **61%
of their tests are the same handful of shapes repeated per tool**; only 35 are
genuinely tool-specific:

| Reused shape | Instances | Tools |
| --- | --- | --- |
| "*X* accounts associated with users" | 11 | Every integration |
| "*X* accounts deprovisioned when personnel leave" | 10 | Every integration except Anthropic-inbound |
| Issue SLA set (P0–P3 resolved, tracked, assigned, prioritized) | 18 | GitHub, Linear, Notion |
| Asset-inventory quality (owners, descriptions, tracks user data) | 8 | Supabase, Vercel, GitHub |
| Storage bucket encrypted | 2 | Supabase, Vercel |

The lesson for dilligent: implement three **parameterised check templates**
once, then bind each new provider to them with configuration. That converts
roughly two-thirds of the per-tool work into a one-time build.

### Pattern A — SaaS account lifecycle
Two checks per provider, driven by the provider's member list plus the HR
roster: (1) every account maps to a known active person — catches shared,
orphaned, and ex-employee accounts; (2) accounts are deprovisioned within the
policy SLA after termination.
→ tasks: `Employee Access`, `Access Review Log`, `Offboarding Checklist: Access & Asset Return`
→ criteria: CC6.1, CC6.2, CC6.3, A.5.15, A.5.16, A.5.18, A.5.11

This single pattern, applied across the ~15 SaaS tools in use, is the highest
evidence yield per unit of engineering in the whole roadmap.

### Pattern B — Issue/vulnerability SLA
Findings carry a severity, an owner, and a resolution timestamp; the check
asserts each severity band closes within its policy SLA and that nothing sits
unassigned or unprioritised.
→ tasks: `Vulnerability Scanning & Remediation`, `Incident Response`, `Corrective Action Register`
→ criteria: CC7.1, CC7.3–7.5, A.8.8, A.5.24–5.28, 10.1, 10.2
→ sources: GitHub Security tab, Linear, Aikido, Grafana alerts

### Pattern C — Asset inventory quality
Every discovered resource has an owner and a description, and resources
holding customer data are flagged.
→ tasks: `Infrastructure Inventory`, `Device List`
→ criteria: CC6.1, A.5.9, A.8.1

## Per-tool recommendations

Ordered by evidence value, not alphabetically. "*(unbound)*" marks an evidence
task that has **no** automated check today.

### Tier 1 — fills controls with zero automation

#### Bitwarden
Credential Management and Authentication Enforcement currently rest on
`Secure Secrets` (Azure Key Vault only) and `2FA`.

| Check | Task | Criteria |
| --- | --- | --- |
| Master-password policy enforced (length, complexity, reuse) | `Password Policy Configuration Evidence` *(unbound)* | CC6.1, A.8.5 |
| Org-wide 2FA policy enforced | `2FA` | CC6.1, CC6.6 |
| Member + collection access review; no orphaned vaults | `Access Review Log` *(unbound)* | CC6.2/6.3, A.5.15–5.18 |
| Personal-vault export disabled; sharing policy set | `Data Egress & DLP Controls` *(unbound)* | A.8.12 |
| Event-log retention configured | `Audit Log Configuration & Retention` *(unbound)* | A.8.15 |
| Pattern A | account lifecycle | CC6.2, A.5.11 |

Note: GRC Tools ships only Pattern A for Bitwarden (2 tests). The policy-enforcement
checks above are a genuine capability gain over the commercial baseline.

#### Grafana Cloud
The Security Logging control has **no** checks at all today.

| Check | Task | Criteria |
| --- | --- | --- |
| Log retention window + centralized ingestion | `Audit Log Configuration & Retention` *(unbound)* | CC7.2, A.8.15 |
| Alert rules defined and firing history non-empty | `Monitoring & Alerting` | CC7.2, A.8.16 |
| On-call schedule populated (Grafana OnCall) | `Incident Response` *(unbound)* | CC7.3–7.5, A.5.24–5.26 |
| SLO / uptime dashboards, synthetic monitors | `App Availability` | A1.1, A.8.6 |
| Pattern A | account lifecycle | CC6.2 |

GRC Tools ships 3 tests here (accounts ×2 + "has active alerts"). Log retention and
on-call coverage are ours to add.

#### DocuSign
Converts four manual people-evidence tasks into API-verifiable ones. No GRC Tools
equivalent exists.

| Check | Task | Criteria |
| --- | --- | --- |
| NDA envelopes completed for all active staff | `Confidentiality & NDA Agreements` *(unbound)* | CC1.1, A.6.2, A.6.6 |
| Code-of-conduct envelopes completed | `Code of Conduct Acknowledgment` *(unbound)* | CC1.1, CC1.4 |
| Vendor DPAs / contracts executed | `Supplier Evaluation Records` *(unbound)* | CC9.2, A.5.20 |
| Policy approval signatures captured | `Policy Documentation & Retention` *(unbound)* | CC5.3, A.5.1 |

#### Justworks
The HR roster is the *population* every access review and offboarding sample is
measured against; without it, completeness cannot be demonstrated.

| Check | Task | Criteria |
| --- | --- | --- |
| Active-employee roster export | `Employee Verification` *(unbound)* | CC1.1, A.6.1 |
| Termination dates → cross-checked against IdP revocation timestamps | `Offboarding Checklist` *(unbound)* | **CC6.2** |
| Background-check completion status | `Employee Verification` | A.6.1 |
| Performance-review completion | `Employee Performance Evaluations` *(unbound)* | CC1.4, A.6.3 |

⚠️ Justworks has no broad public API. Confirm whether report export / SFTP is
viable before committing; this may be a scheduled import rather than a check.

### Tier 2 — extend tools already integrated

#### GitHub (5 checks today; GRC Tools ships 25)
The richest gap. The GRC Tools catalog is a useful specification here.

| Check | Task | Criteria |
| --- | --- | --- |
| Secret scanning + push protection enabled | `Secure Secrets` | A.8.28 |
| **Merged-PR sample: approvals, passing checks, author ≠ reviewer** | `Change Approval Samples` *(unbound)* | **CC8.1**, A.8.32 |
| Branch protection enforced *for administrators* | `Code Changes` | CC8.1, A.8.32 |
| Repository visibility private; stale org invitations (>365d) | `Access Review Log` | CC6.1, A.8.2 |
| Dependency vulnerabilities closed within SLA by severity | `Vulnerability Scanning & Remediation` *(unbound)* | CC7.1, A.8.8 |
| Actions policy: allowed-actions allowlist, OIDC not long-lived secrets | `Secure Code` | A.8.28 |
| Org SAML/SSO enforced; audit-log streaming enabled | `Audit Log Configuration & Retention` | A.8.15 |
| Patterns A, B, C | lifecycle / issue SLA / inventory | CC6.2, CC7.1, A.5.9 |

The merged-PR sample directly supplies the CC8.1 operating-effectiveness
evidence flagged as missing in the SOC 2 expert review — branch-protection
configuration proves design, not operation.

#### Google Workspace (2 checks today; GRC Tools ships 4)
The single richest untapped source; GRC Tools barely scratches it.

| Check | Task | Criteria |
| --- | --- | --- |
| Drive external-sharing restrictions + DLP rules | `Data Egress & DLP Controls` *(unbound)* | **A.8.12** |
| Endpoint verification / managed-device inventory | `Device List`, `Secure Devices` | A.7.9, A.8.1 |
| Super-admin count and least privilege | `Access Review Log` | CC6.1, A.8.2 |
| Password policy + session timeout settings | `Password Policy Configuration Evidence` *(unbound)* | CC6.1, A.8.5 |
| Gmail forwarding restrictions; Vault retention rules | `Media Sanitization & Disposal Log` *(unbound)* | A.8.10 |
| Login audit + suspicious-login alerting | `Audit Log Configuration & Retention` | A.8.15, A.8.16 |
| Third-party OAuth app allowlist | `Supplier Evaluation Records` | A.5.19 |

The device-inventory checks matter disproportionately: the **Mobile Device
Management control has no automated checks at all** right now.

#### Vercel (2 checks today; GRC Tools ships 14)
The GRC Tools list is heavily storage/database-oriented — worth mirroring.

| Check | Task | Criteria |
| --- | --- | --- |
| Deployment protection on preview environments | `Separation of Environments` | A.8.31 |
| Blob/storage encrypted; secure bucket access | `Encryption at Rest` | A.8.24 |
| Postgres/KV backups daily; SSL enforced on connections | `Backup logs`, `TLS / HTTPS` | A.8.13, A.5.14 |
| Firewall / unwanted-traffic filter configured | `Production Firewall & No-Public-Access Controls` | CC6.1, A.8.20–8.23 |
| Sensitive env-var handling | `Secure Secrets` | A.8.28 |
| Log drains configured | `Audit Log Configuration & Retention` | A.8.15 |
| Production deployment approvals | `Change Approval Samples` | CC8.1 |
| Patterns A, C | lifecycle / inventory | CC6.2, A.5.9 |

#### Linear (1 check today; GRC Tools ships 9)
The GRC Tools Linear tests are Pattern A + Pattern B. Add both, plus SSO/2FA
enforcement, admin least privilege, and guest/external member audit.
→ `Access Review Log`, `Corrective Action Register` *(unbound)*, `Incident Response` *(unbound)*
→ CC6.2, CC7.3–7.5, A.8.2, 10.1

### Tier 3 — new integrations, solid value

#### Neon DB
The production data store; should be a first-class evidence source. GRC Tools has
no Neon integration — model it on their Supabase check set (16 tests), which is
the closest analogue.

| Check | Task | Criteria |
| --- | --- | --- |
| Encryption at rest enabled | `Encryption at Rest` | A.8.24, C1.1 |
| TLS/SSL enforced on connections | `TLS / HTTPS` | A.5.14 |
| IP allowlist / no public endpoint on production | `Production Firewall & No-Public-Access Controls` | CC6.1, A.8.20–8.23 |
| PITR / backup retention window configured | `Backup logs` | A.8.13 |
| Restore test evidence | `Backup Restoration Test` | A1.2, A.8.13 |
| Production vs. development project separation | `Separation of Environments` | A.8.31 |
| Role inventory per project | `Role-based Access Controls` | A.8.2 |
| Log retention ≥ policy minimum | `Audit Log Configuration & Retention` | A.8.15 |

#### Slack
| Check | Task | Criteria |
| --- | --- | --- |
| 2FA / SSO enforcement | `2FA` | CC6.1, CC6.6 |
| Message + file retention policy configured | `Media Sanitization & Disposal Log` | A.8.10 |
| Export controls, Slack Connect / external-share restrictions | `Data Egress & DLP Controls` | A.8.12 |
| Approved-app inventory (shadow IT) | `Supplier Evaluation Records` | A.5.19 |
| Patterns A | lifecycle, guest accounts | CC6.2, A.5.11 |

#### PostHog
The only credible home for one of our controls — Data Masking has one manual
task and no checks.

| Check | Task | Criteria |
| --- | --- | --- |
| Session-recording masking / PII redaction enabled | `Data Masking` *(unbound)* | **A.8.11** |
| Data-retention configuration | `Media Sanitization & Disposal Log` | A.8.10 |
| Project member roles + SSO enforcement | `Access Review Log` | CC6.2, A.8.2 |
| API-key inventory and rotation | `Secure Secrets` | A.8.28 |

#### Notion
GRC Tools ships Pattern A + Pattern B here. The high-value addition is exposure
detection, which GRC Tools does **not** cover:

| Check | Task | Criteria |
| --- | --- | --- |
| **Publicly-shared page audit** (internal docs exposed to web) | `Data Egress & DLP Controls` | A.8.12, A.5.12 |
| Member/guest review, SCIM/SSO enforcement | `Access Review Log` | CC6.2, A.8.2 |
| Integration-token inventory | `Secure Secrets` | A.8.28 |
| If policies are hosted here: page currency and approval | `Policy Documentation & Retention` | CC5.3, A.5.1 |

#### Attio
Holds customer PII, so it carries privacy-framework weight (CCPA and PIPEDA are
both seeded). **GRC Tools has no Attio integration at all** — confirmed absent from
their catalog — so this is manual evidence on a commercial platform.

| Check | Task | Criteria |
| --- | --- | --- |
| Access review + SSO/2FA enforcement | `Access Review Log` | CC6.2, A.8.2 |
| Record deletion / DSAR fulfilment evidence | `Customer Data Deletion Evidence` *(unbound)* | P4.3, C1.2, A.8.10 |
| Export controls + API-token inventory | `Data Egress & DLP Controls` | A.8.12 |
| Pattern A | lifecycle | CC6.2 |

#### Mercury Bank
Narrow but covers two things nothing else does. No GRC Tools equivalent.

| Check | Task | Criteria |
| --- | --- | --- |
| Dual-approval / payment-limit configuration | `Role-based Access Controls` (Segregation of duties) | **CC5.1**, A.5.3 |
| Who-can-move-money access review | `Access Review Log` | CC6.2 |
| 2FA enforcement on banking access | `2FA` | CC6.1 |

The payment-approval configuration is also the most natural supporting evidence
for the **fraud-risk consideration (CC3.3)** that the SOC 2 review flagged as
un-evidenced.

### Tier 4 — vendor-register entries, not check sources

**Stripe.** Effectively a subservice organization: collect their SOC 2 report
rather than config checks. The public API does not expose dashboard team
members or MFA status. Genuinely checkable surface is thin — webhook endpoints
enforce HTTPS, restricted (not legacy secret) API keys in use. Everything else
→ `Supplier Evaluation Records`, `Vendor Register & Risk Tiering`.

**Granola.** Processes confidential meeting content but exposes no admin or
compliance API. Value is a vendor risk-tiering entry, a DPA on file, a
documented transcript-retention setting, and manual account review. Also an
AI-governance entry should ISO 42001 be pursued.

**Supabase (deprecated).** The test here is **decommissioning proof**, not
ongoing configuration: projects deleted or paused, production data purged,
credentials revoked, access removed → `Customer Data Deletion Evidence`,
`Media Sanitization & Disposal Log` (C1.2, A.8.10). Auditors do ask about
retired systems. Note that GRC Tools ships 16 Supabase tests — if any Supabase
project is still live, that list (encryption, IP restriction, SSL, daily
backups, log retention, public-bucket blocking) is the specification to match
until decommissioning completes.

**Codex.** Ambiguous — assumed to be OpenAI Codex. On an enterprise/admin plan
there is an admin API (members, projects, API keys, audit logs) → Pattern A,
`Secure Secrets`. Otherwise the controls are policy-shaped: AI-generated code
passes the same branch-protection and review gates (`Change Approval Samples`),
data-sharing/training settings documented (A.5.14), plus a vendor entry.
The GRC Tools catalog includes an **Anthropic** integration doing exactly Pattern A,
which confirms AI-vendor account lifecycle is an established check category.
*Open question: confirm which product "Codex" refers to.*

## Benchmark against the GRC Tools catalog

From the supplied export of 13 GRC Tools integrations (89 tests):

**Where GRC Tools is deeper than our plan and worth copying:** GitHub (25 tests —
notably author ≠ reviewer, branch protection enforced for admins, per-severity
vulnerability SLAs, stale-invitation detection) and the storage/database check
sets for Supabase and Vercel.

**Where our plan exceeds GRC Tools:** Bitwarden (they ship account lifecycle only;
we add password-policy and export-restriction enforcement), Grafana Cloud (they
ship 3 tests; we add log retention and on-call), Google Workspace (they ship 4;
we add DLP, device inventory, retention), and Notion (they omit public-page
exposure detection).

**Tools with no GRC Tools coverage at all** — manual evidence even on the
commercial platform, and therefore differentiation opportunities:
Attio (explicitly absent), Stripe, Neon, PostHog, DocuSign, Justworks, Mercury,
Granola, Codex.

**Also noted:** The GRC Tools Google Drive integration performs document/policy sync
only, with no tests or controls — relevant if Drive is ever considered an
evidence source. Their catalog also carries Xero (accounting, Pattern A only),
which is the shape any future accounting-system integration would take.

## Highest-value single check

**Justworks termination dates × Google Workspace / Bitwarden / GitHub / Slack
revocation timestamps.** A cross-tool check measuring revocation-within-SLA per
leaver produces exactly the population auditors sample for **CC6.2**, the most
common Type II exception area. No single-tool check can produce it, and it is
pure manual evidence today. It is also Pattern A generalised — build the
pattern, and this check becomes configuration.

## Suggested sequence

1. **Pattern A** (SaaS account lifecycle) as a reusable template → bind to
   Google Workspace, GitHub, Slack, Bitwarden, Linear, Notion, Vercel, Attio,
   PostHog, Grafana. One build, ten integrations, the largest single coverage gain.
2. **Bitwarden** and **Grafana Cloud** manifests — each closes a control that
   has zero automation today.
3. **GitHub** extension — merged-PR sampling first (CC8.1 evidence gap), then
   secret scanning and Pattern B.
4. **Google Workspace** extension — DLP and device inventory.
5. **Neon** manifest, modelled on the GRC Tools Supabase check set.
6. **DocuSign** + **Justworks** — converts the people/HR evidence domain from
   manual to automated, subject to the Justworks API caveat.
7. **Pattern B** and **Pattern C** templates, bound across GitHub, Linear,
   Aikido, Grafana.

## Prerequisites and constraints

- **Task-mapping regeneration is required before any new check can bind to the
  new evidence tasks.** `packages/integration-platform/src/task-mappings.ts` is
  generated from the seed task templates; it was regenerated on this branch
  (64 → 173 ids). Re-run `bun run generate:tasks` in
  `packages/integration-platform` after any future seed change that adds tasks.
- Prefer `DynamicIntegration` rows over hand-written manifests unless a check
  needs non-declarative logic.
- Each new check must declare `taskMapping`; a check with no task mapping
  produces findings that never reach a control.
- Several recommendations depend on plan tier (Google Workspace Enterprise for
  DLP and Vault, GitHub Enterprise for audit-log streaming, Grafana OnCall,
  OpenAI enterprise admin API). Confirm entitlements before scheduling.
