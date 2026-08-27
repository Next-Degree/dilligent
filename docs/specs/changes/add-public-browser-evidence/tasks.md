## Design Decisions

Settle these before coding — each one changes the shape of the diff.

- **`authMode` is a Prisma enum, not a string.** Every other fixed vocabulary in
  `browserbase-context.prisma` is an enum (`BrowserAuthProfileStatus`,
  `BrowserAutomationRunStatus`, `BrowserAutomationFailureCode`,
  `BrowserAutomationFailureStage`). Add
  `enum BrowserStepAuthMode { saved_session public }` and default the column to
  `saved_session` so existing rows and omitted payloads keep today's behavior.
- **Public sessions use a throwaway context, not "no context".** Browserbase has
  no context-less session API — `createSessionWithContext` requires a
  `contextId`. Follow the existing precedent in
  `browser-login-analyzer.service.ts:43-50`: call `createBrowserbaseContext()`,
  then `createSessionWithContext(contextId, CAPTURE_VIEWPORT, false)`. The
  `persist: false` argument is what guarantees nothing is written back. The
  context id is never stored on a BrowserAuthProfile or any other row. Cost: one
  extra Browserbase API call per public run.
- **Public runs skip the profile lock, keep the domain throttle.**
  `browserRunCoordinator.withProfileLock` is keyed by a required
  `profileId: string`, and a public run has none. There is also no shared cookie
  context to serialize, so the profile lock is meaningless for public runs. The
  per-host pacing in `withDomainTurn` is still wanted so repeated public runs
  don't hammer one site — but it is currently `private`. Expose it (a public
  `withDomainTurn`, or a named `withPublicRun({ hostname, run })` wrapper) rather
  than inventing a synthetic profile id to satisfy the lock.
- **Do not overload `profileId: null` as the mode signal.** Legacy steps already
  use null to mean "resolve a connection by host". `authMode` is the only
  discriminator; `profileId` is forced to null for public steps but never read
  to infer mode.

## Affected Code

Every place that assumes a step has a profile. All were verified against the
current branch — items 1-4 are the run path, 5-6 the composer test path.

1. `browser-automation-step-runner.service.ts`
   - `resolveStepProfile` — must not be called at all for public steps.
   - `runStep` — currently short-circuits to `profileMissingResult()` when
     `profile` is null (`browser-automation-step-results.ts:51-62`). Public steps
     must take a new branch instead of that error, and must skip the
     `applyProfileResult` call that follows.
2. `browser-evidence-runner.service.ts`
   - `BrowserEvidenceRunnerInput.profile` is a required object supplying
     `id`/`hostname`/`contextId`. It must become optional (or be paired with a
     public variant), since both `runEvidence` (session creation, line 102) and
     `executeEvidenceOnSession` (line 133) read it.
3. `browser-evidence-execution.ts`
   - `executeBrowserEvidence` runs `checkAuth` then
     `reloginWithStoredCredentials` unconditionally at lines 208-244. Public runs
     skip both and go straight from `navigation` to the `action` stage. The
     `vault` argument is unused on the public path.
4. `browser-automation-execution.service.ts`
   - `startAutomationWithLiveView` (lines 60-77) hard-throws
     `NotFoundException('No connection is bound to this automation…')` when the
     first step has no profile, then opens the live session on
     `profile.contextId`. This is the interactive "Run" entry point and is the
     single guaranteed failure for a public first step.
   - `executeAutomationOnSession` (line 111) calls `resolveProfileForTarget`
     directly for the legacy single-step path.
   - `runBrowserAutomation` (line 224) already tolerates a null profile when
     creating the run row — confirm it stays that way.
5. `browser-instruction-test.service.ts`
   - `testInstructionOnSession` calls `resolveProfileForTarget` unconditionally
     and builds a synthetic `automationId: test-${profile.id}` used for the
     screenshot key path. Public tests need a profile-free substitute id.
6. `browserbase.service.ts`
   - `testInstruction` calls `resolveProfileForTarget` then opens the session on
     `profile.contextId`, and forwards `profileId` into the
     `test-vendor-instruction` Trigger task payload.

Note that `resolveProfileForTarget`
(`browser-auth-profile.service.ts:151-189`) falls through to
`getOrCreateProfileFromUrl` — so any missed call site silently *creates* a
BrowserAuthProfile for the public host, which the proposal explicitly forbids.

## Implementation

- [ ] Add the auth mode to the schema.
  - `enum BrowserStepAuthMode { saved_session public }`.
  - `authMode BrowserStepAuthMode @default(saved_session)` on
    `BrowserAutomationStep`.
  - Migration via `cd packages/db && bunx prisma migrate dev`, then regenerate.
- [ ] Extend DTOs and service input types.
  - `BrowserAutomationStepDto` — add `authMode`, validated with `@IsEnum`.
  - `DraftStepDto` — add `authMode` so a public draft round-trips.
  - `BrowserAutomationStepInput` (`browser-automation-crud.service.ts:13-18`)
    and `toStepCreate` (line 39-47), which runs on both create and update
    (update deletes and recreates steps).
  - `StepForRun` (`browser-automation-step-results.ts:4-11`) and `stepsForRun`,
    including the legacy inline-instruction branch, which must produce
    `saved_session`.
- [ ] Close the URL-validation gap on drafts.
  - `DraftStepDto.targetUrl` currently carries only `@IsString()` — no `@IsUrl`
    or `@IsSafeUrl`. That was harmless while the URL was always derived from a
    server-created connection, but public mode makes drafts a user-controlled
    URL sink. Add the same `@IsUrl` + `@IsSafeUrl` pair used on
    `BrowserAutomationStepDto.targetUrl`.
  - Confirm `TestInstructionDto.targetUrl` already validates (it does) and that
    the public test path cannot bypass it.
- [ ] Add public session support.
  - Fresh throwaway context + `persist: false` + `CAPTURE_VIEWPORT`, per the
    design decision above.
  - Close the session on both success and failure — reuse the existing
    `try/finally` in `runEvidence` rather than adding a second teardown path.
- [ ] Split the evidence execution auth behavior.
  - `saved_session`: unchanged `checkAuth` + `reloginWithStoredCredentials`.
  - `public`: skip both; navigation goes straight to the action stage.
  - Keep the log/timeline stages coherent — a public run should not emit an
    `auth` stage entry it never performed.
- [ ] Make the profile optional through the runner.
  - Thread the mode (or an optional profile) through
    `BrowserEvidenceRunnerInput` without `as any` casts or a second parallel
    runner. Prefer a discriminated input over a nullable field so the compiler
    forces every read site to handle both.
- [ ] Update the coordinator.
  - Public runs take the domain turn without a profile lock.
- [ ] Update run bookkeeping.
  - `BrowserAutomationRun.profileId` stays null for a public-first run (the
    column is already nullable).
  - `BrowserAutomationStepRun` completes normally.
  - `applyProfileResult` is not called for public steps.
- [ ] Update live run behavior.
  - `startAutomationWithLiveView` opens a public session for a public first step
    instead of throwing.
  - Later public steps open their own fresh sessions inside `runSteps`.
  - Live view and the `switching`/`finishing` phase signals work unchanged.
- [ ] Update the composer UI.
  - **Target URL entry is a new control, not a tweak.** The composer has no URL
    field at all today — `InstructionComposer.tsx:348` derives
    `targetUrl: connectionOf(step.profileId).url` at save time. Public steps need
    a real input, `targetUrl` added to `EditableStep`, and threading through
    `initialSteps` restore (lines 82-114), the autosave payload (lines 244-248),
    and `handleSave` (lines 346-351).
  - Add "Public page / no login" to `ConnectionPicker`. Its `value`/`onChange`
    are typed as a plain `profileId: string` with real ids as the only valid
    values, so this needs a sentinel distinct from any profile id — or, cleaner,
    lift the mode out of the picker into its own control on `StepCard`.
  - `connectionOf` (lines 158-162) falls back to the primary `connection` for any
    unmatched id, so a naive sentinel silently resolves to a real connection.
    Public steps must yield `undefined` for `StepCard`'s `connection` prop.
  - `blockedStepIndex` (lines 168-171) blocks saving whenever a step's connection
    is not `verified`; public steps must be excluded, and instead validated on
    having a usable URL.
  - Reconnect prompts already no-op for a step with no connection
    (`StepCard.tsx:31-32` gates on `connection?.status`), so this needs a test to
    lock the behavior in, not new logic.
- [ ] Open an entry point for connection-free public evidence.
  - `BrowserAutomations.tsx:400` renders the composer only when
    `composerConnection` exists, and with zero profiles the user is sent to
    `BrowserEvidenceEmptyState` ("connect a vendor first"). An org with no
    connections currently cannot reach the composer at all — which is exactly
    the org most likely to want public-page evidence.
  - Make `InstructionComposer`'s `connection` prop optional, or seed a
    public-mode step so the composer opens without one.
- [ ] Support testing a public step.
  - `TestInstructionDto` + `testInstruction` + `testInstructionOnSession` +
    the `test-vendor-instruction` Trigger payload all carry the mode.
  - Replace the `test-${profile.id}` synthetic id with a public-safe one.
  - `handleTest` (`InstructionComposer.tsx:325-331`) sends the step's own
    `targetUrl` instead of `activeConnection.url`.

## Tests

- [ ] CRUD stores and returns `authMode` on create and on update (update
      recreates steps, so both paths need coverage).
- [ ] `stepsForRun` defaults legacy rows and the inline-instruction branch to
      `saved_session`.
- [ ] Step runner does not call `resolveStepProfile` for a public step, and does
      not return `profileMissingResult()` for one.
- [ ] Evidence execution skips `checkAuth` and `reloginWithStoredCredentials`
      for public steps, and still runs them for `saved_session`.
- [ ] A public run creates its session with `persist: false` on a context that
      is not any profile's `contextId`.
- [ ] A public run closes its session on the failure path as well as on success.
- [ ] Public runs never call `markVerified` / `markNeedsReauth` / `markBlocked`.
- [ ] A public run against a host with no saved profile does not create a
      BrowserAuthProfile (guards the `getOrCreateProfileFromUrl` fallthrough).
- [ ] `startAutomationWithLiveView` does not throw for a public first step.
- [ ] Mixed automation: step 1 saved-session, step 2 public, both roll up.
- [ ] Draft round-trip preserves `authMode` and `targetUrl`.
- [ ] `DraftStepDto` rejects an unsafe target URL.
- [ ] Composer saves a public step as `authMode: "public"`, `profileId: null`,
      with the user-entered URL.
- [ ] Composer does not render a reconnect prompt for a public step.
- [ ] Composer allows saving an automation containing a public step while an
      unrelated connection is unverified.

## Verification

- [ ] `cd apps/api && npx jest src/browserbase --passWithNoTests`
- [ ] `cd apps/app && npx vitest run` for the browser automation composer tests.
- [ ] `npx turbo run typecheck --filter=@trycompai/api`
- [ ] Manual test: create public automation for a public privacy policy URL from
      an org with **no** connections.
- [ ] Manual test: run public automation and confirm screenshot/evaluation is
      captured without creating/requiring a browser auth profile — check the
      connection list is unchanged afterwards.
- [ ] Manual test: test a public step from the composer and watch the live view.
- [ ] Regression test: existing authenticated automation still requires and uses
      the saved connection.
- [ ] Regression test: an automation mixing a saved-session step and a public
      step produces evidence for both.
