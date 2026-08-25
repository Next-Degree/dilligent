## Implementation

- [ ] Add a step auth mode field to the Browserbase automation schema.
  - Suggested field: `authMode String @default("saved_session")`
  - Valid values at the application layer: `saved_session`, `public`
  - Add migration and regenerate Prisma types.
- [ ] Extend Browserbase DTOs and service input types.
  - `BrowserAutomationStepDto`
  - `BrowserAutomationStepInput`
  - `StepForRun`
  - Create/update automation payloads.
- [ ] Preserve backward compatibility.
  - Existing rows and payloads default to `saved_session`.
  - `profileId: null` with omitted auth mode continues current host-profile
    resolution behavior.
- [ ] Add Browserbase session support for public runs.
  - Create fresh session without a saved context.
  - Set `persist: false`.
  - Use capture viewport.
  - Close the session after run completion/failure.
- [ ] Split evidence execution auth behavior.
  - `saved_session`: keep current `checkAuth` and stored-credential relogin.
  - `public`: skip `checkAuth` and `reloginWithStoredCredentials`.
- [ ] Update run bookkeeping.
  - BrowserAutomationRun `profileId` may be null for public runs.
  - BrowserAutomationStepRun should complete normally for public steps.
  - Profile health updates must be skipped for public steps.
- [ ] Update live run behavior.
  - Public first step should be able to start with a live Browserbase session.
  - Public later steps should open their own fresh session.
  - Live view should work the same as authenticated steps.
- [ ] Update composer UI.
  - Add a "Public page / no login" option in the step connection selector.
  - When selected, allow manual target URL entry.
  - Save `authMode: "public"` and `profileId: null`.
  - Disable reconnect prompts for public steps.
- [ ] Update tests.
  - CRUD stores and returns auth mode.
  - Step runner does not resolve profiles for public steps.
  - Evidence execution skips auth/relogin for public steps.
  - Public runs do not update profile health.
  - UI saves public steps correctly.

## Verification

- [ ] Unit tests pass for `apps/api/src/browserbase`.
- [ ] Relevant app Vitest tests pass for browser automation composer.
- [ ] Manual test: create public automation for a public privacy policy URL.
- [ ] Manual test: run public automation and confirm screenshot/evaluation is
      captured without creating/requiring a browser auth profile.
- [ ] Regression test: existing authenticated automation still requires and uses
      the saved connection.

