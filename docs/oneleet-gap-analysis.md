# Dilligent vs Oneleet: gap analysis and improvement roadmap

Date: 2026-10-10. Method: Oneleet docs and product pages (text only), then 13 parallel read-only code reviews of dilligent, each benchmarked against a shared Oneleet feature brief.

## Caveats

- **No screenshots.** The fetch tool returns text only, so the Oneleet comparison is based on docs and marketing copy, not on seeing flows. Third-party reviews (not verified) say Oneleet supports one framework at a time and has quote-only bundled pricing.
- Findings come from subagents reading code. I did not independently re-verify each one. Treat "lacks X" as "agent grepped and found nothing", and spot check before committing to build work. The questionnaire findings are the least certain.

## Where dilligent is already ahead or at parity

- **Integration breadth:** 590 catalog integrations vs Oneleet's 30+. All Oneleet integrations are covered by name except Iru (possibly Kandji). Depth is the issue (see below).
- **Trust center:** access request approve/deny, NDA flow, time limited grants, custom domain, FAQs.
- **Policies:** versioning, approval flow, templates from the framework editor, AI editing.
- **Cloud security:** AWS, GCP, Azure scans with AI remediation and finding exceptions with required reason and expiry.
- **Devices:** custom cross-platform agent with auto-remediation.
- **API keys:** salted hashes, scopes, creator attribution. Hosted MCP exists.

## Themes (ranked by impact)

### 1. The compliance core is a rollup, not a status engine (highest leverage)

Oneleet's model: controls are backed by monitors, policies, integrations and evidence, with states Failing, Needs changes, In review, In progress, Passing. Requirements are "Met" only when all mapped controls pass.

Dilligent: control status is policies published plus tasks done, computed in two places (`controls.service.ts` and `controls/lib/utils.ts`). Integration check results and cloud findings do not feed it. No failing state, no requirement rollup, no control owner field, no control CSV export, no evidence library, no audit period entity.

- Single server side status function combining policies, tasks, integration results, cloud findings (H, M)
- Requirement "Met" rollup and framework readiness (H, S)
- Control owners, bulk assign, CSV export (H, S/M)
- Audit period model with in-period evidence validation and rollover unlink (H, L)
- Evidence library with many-to-many links, then auto-attach (M, L)

### 2. Continuous monitoring, SLAs and alerting

Dilligent runs checks daily (Oneleet hourly). There are no SLA deadlines, no Alerting vs Breaching status, no snooze or disable of a check, no thresholds, and no alert when a check fails. Ignore with reason and expiry exists, but only per finding.

- Severity based finding SLAs with Breaching/Alerting status (H, M)
- Scheduled reminder and SLA job. The `taskReminders` and `weeklyTaskDigest` flags appear to be dead settings with no sender (H, M)
- Snooze and disable at check level with required reason and review date (M, M)
- Hourly cadence for identity and cloud providers, per connection (M, M)
- Alert when an integration connection errors or goes stale (H, S/M)

### 3. Notifications

Email (Resend) plus Novu in-app. No Slack channel. Preferences are six role-level booleans with no per-type or per-channel control, no digest, no catalog. Five notifier services duplicate the unsubscribe and role checks.

- `NotificationPreference` model and single dispatcher (H, M/H)
- Slack channel after the dispatcher exists (M/H, M)
- Notification catalog page (M, S)

### 4. Security product gaps

Dilligent has an AI driven pentest (third party engine), cloud security, and GitHub setting checks only. Lacks: SAST, secrets scanning, dependency scanning, PR checks, autofix, attack surface management, human pentest engagements, scheduled or retest scans, report auto-attached to controls.

- Auto-attach pentest report to controls as evidence (H, S)
- Scheduled scans plus "retest this finding" (H, S/M)
- Findings triage states: accept risk, false positive, with audit log (M/H, M)
- Ingest GitHub Dependabot and secret scanning alerts as a cheap first step (1 to 2 weeks) (M/H, S)
- Then wrap open source scanners (Opengrep, Gitleaks, OSV or Trivy) in Trigger.dev workers. Check Opengrep and rule licensing first (H, H)
- Light ASM with subfinder, crt.sh, naabu (M, M)
- Defer: autofix, human pentest engagements

### 5. People and access

No detected accounts (shadow IT), no scheduled access reviews, offboarding records confirmation but does not verify deprovisioning, no employee vendor request flow in the portal, device agent has 4 checks and no MDM or FileVault key escrow.

- Detected accounts: categories, link/add/ignore/snooze with reason, failing check (H, H). Reuse `directory-provider.ts`.
- Scheduled access reviews with auto-attached evidence (H, M/H)
- Verified offboarding via integration state (H, M)
- Employee vendor request flow plus required approve/deny reason (H, M/L). Reuses the existing discovery queue.
- More agent checks: patch level, firewall, app inventory (M, M). Defer full MDM.

### 6. AI (opportunity and risk)

Existing AI is broad (assistant, RAG questionnaires, remediation advice) but has no evidence review, no cost controls and thin tracing (3 of about 25 call sites).

- AI evidence review with validated/flagged/failed verdict, checking period and timestamp (H, M)
- Per org token ledger, rate limits and `maxOutputTokens` on assistant chat (H, S/M)
- Upstash namespace per org instead of metadata filtering. Count and delete use top-K then client filter, which can miss vectors on offboarding (H, S/M)
- Audit readiness score and control gap explainer (H, M), best done after theme 1
- Remediation PRs (M/H, H)

### 7. API, MCP, audit log

- MCP does not filter tools by key scope (`mcpScopes` is empty), exposes 413 generated tools, no response size guard (H, M)
- API key rotation, custom expiry, expiry warnings, scope edit (H, S)
- Audit log: dedicated `audit:read`, date/user/action filters, cursor pagination, export (H, M)
- Custom integrations exist internally (`internal/dynamic-integrations`) but are not customer facing (H, M)
- Policy acknowledgement is a flat `signedBy[]` with no per-version record or reminders (H, M)
- VDP and `security.txt` on the trust center (H, S)

### 8. UX

Command search exists (permission gated, keyword based) but only navigates. The dashboard is score centric rather than action centric.

- "Needs attention" panel merging inbox, failing controls, overdue and due soon items (H, M)
- Shared status vocabulary and filters across controls, tasks, cloud tests (H, M/L)
- Entity and action search in Cmd+K, visible hint (M/H, M)
- Design system migration: 422 files still import `@trycompai/ui`, 270 `lucide-react`. Add a lint rule to block new ones (M, L)

## Security findings to fix first (a compliance product must be exemplary)

No P1 found in the areas checked. Not reviewed: most of `auth/` session code.

1. **Webhook fails open** (`integration-platform/controllers/webhook.controller.ts` ~105). Signature is verified only if the manifest configures it; otherwise any POST inserts runs and findings for a tenant. Secret sits in plaintext connection metadata. Reject when unsigned, move secret to the vault.
2. **`InternalTokenGuard` fails open** when `INTERNAL_API_TOKEN` is unset and `NODE_ENV !== 'production'`, and compares non constant time (`auth/internal-token.guard.ts`). Fail closed, use `timingSafeEqual`.
3. SSRF validator checks hostname strings only, no DNS resolution or redirect checks, misses IPv6 ULA and CGNAT (`browserbase/validators/url-safety.validator.ts`).
4. Secrets controller uses inline body types with no DTO validation; check-then-write uses `where: { id }` (`secrets/`).
5. Presigned upload does not bind content type or size and has no `@RequirePermission` (`uploads/`).
6. Unbounded pagination loops on request path in `sync.controller.ts`; unencoded vendor id in a URL path (~1288).
7. Vector store filter is string interpolated (low exposure, org id is server derived).

## Code health (against CLAUDE.md rules)

| Metric | Count |
|---|---|
| Source files over 300 lines | 486 (352 non test). Worst: `trust-access.service.ts` 2907, `sync.controller.ts` 2363 |
| `as any` | 456 (112 outside tests) |
| `@ts-ignore` / `@ts-expect-error` | 6 / 4 |
| `"use server"` files in apps/app | 62 |
| Files in apps/app importing `@db` | 293 (about 30 with mutations, heuristic) |
| API controllers without spec | 38 of 99 |
| App components without test | 740 of 1206 |

Recommendations: ESLint `max-lines`, `no-explicit-any` and `ban-ts-comment` with a baseline so new violations block first; finish the server action migration for the mutation files; add specs for untested controllers; confirm CI runs vitest and lint (no obvious dedicated workflow by filename); prune turbo `globalEnv`.

## Suggested sequencing

1. **Now (days to 2 weeks):** security fixes 1 and 2, VDP/security.txt, API key rotation, pentest report auto-attach, required reasons on vendor approve/deny, requirement rollup, lint guards.
2. **Next (1 to 2 months):** unified control status and owners, SLA plus reminder job, notification dispatcher, scope filtered MCP, audit log API, AI evidence review and cost ledger, vector namespaces, policy acknowledgements, scheduled scans and triage, "Needs attention" dashboard.
3. **Later:** audit periods and auditor requests, detected accounts, access reviews, Slack, scanner wrapping (SAST, secrets, SCA), ASM, customer facing custom integrations.
4. **Defer:** full MDM, human pentest operations, autofix PRs.

Biggest strategic point: Oneleet's advantage is the closed loop (monitor result changes control status, fix closes the gap, evidence attaches itself). Dilligent has many of the parts (integrations, check results service, cloud findings) but they do not feed a single status model. Theme 1 and 2 unlock most of the rest.
