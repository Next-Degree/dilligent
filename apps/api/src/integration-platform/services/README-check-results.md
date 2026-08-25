# CheckResultsService — reuse any integration check's results

`CheckResultsService` is the **single, universal, read-only** way for any feature to consume
the output of an integration check (2FA, AWS S3, device posture, …). It fetches per-resource
results and returns them in a stable, feature-agnostic envelope. It does **not** interpret
the data — that's the feature's job.

> Service = fetch results (generic). Feature = interpret + map + present.

**Full usage map, examples, and rules:** see the `check-results-service` skill
(`.claude/skills/check-results-service/SKILL.md`).

## 30-second version

```ts
// inject CheckResultsService (exported by IntegrationPlatformModule), then:

// which connected integrations can feed a task, + connection state
await checkResults.listSourcesBoundToTask(orgId, TASK_TEMPLATES.twoFactorAuth);

// full results of a check's latest real run for one connection
await checkResults.getLatestResultsByCheck({ organizationId, connectionId, checkId, resourceType });

// results for a task-bound check from a chosen source (resolves task->check, slug->connection)
await checkResults.getLatestResultsForTask({ organizationId, taskTemplateId, sourceSlug, resourceType });

// connection state for integrations you already know by slug (not task-driven)
await checkResults.listSourcesBySlugs(orgId, ['github', 'okta']);

// every check's latest real run on one connection, as summaries (no result rows)
await checkResults.getLatestRunSummariesByConnection({ organizationId, connectionId });
```

Each row is `{ resourceId, resourceType, passed, title, description, evidence, collectedAt,
runId, connectionId }`. The check-specific payload is `evidence` (raw JSON) — **validate it
with zod in your feature**; the service never types it. Empty array = "no data" (never throws).

## Don't

- Don't query `IntegrationCheckResult` / `CheckRunRepository` directly from a feature — use this service.
- Don't add feature-specific interpretation to the service — keep it universal and read-only.

## Reference consumers

- The People-tab 2FA column: `../controllers/two-factor-source.controller.ts`.
- The vendor Integration tab (checks + who has access): `../../vendors/integration/`.
