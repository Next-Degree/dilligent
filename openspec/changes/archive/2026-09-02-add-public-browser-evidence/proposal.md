# Add Public Browser Evidence Mode

## Why

Browserbase evidence automations currently assume every step needs a saved browser
auth profile. When a step has no `profileId`, execution resolves or creates a
profile for the target host, then checks whether the page is logged in and tries
stored credentials. That blocks valid public evidence use cases, such as
capturing an organization's public privacy policy, terms page, status page, or
trust center page.

We need a first-class way to run a browser evidence step without requiring a
login, without creating a BrowserAuthProfile, and without persisting cookies back
into an organization browser context.

## What Changes

- Add an explicit per-step auth mode for browser evidence:
  - authenticated/saved session: existing behavior.
  - public/no login: new behavior.
- Public steps run in a fresh, non-persistent Browserbase session.
- Public steps skip auth detection and credential re-login.
- Public steps still navigate, execute the instruction, capture screenshots,
  upload evidence, and evaluate pass/fail criteria.
- The composer UI can mark a step as a public page instead of selecting a saved
  connection, and gains a target-URL input — today every step's URL is derived
  from its connection, so there is no URL field at all.
- Public-page evidence becomes authorable by an organization that has never
  connected a vendor login, which the current composer entry point does not
  allow.
- The composer's per-step test runs public steps too, so a public step can be
  proved out before saving.
- Existing automations keep their current behavior by default.

## Non-Goals

- Do not remove or weaken saved-login browser automations.
- Do not infer public/private mode from URL shape alone.
- Do not use `profileId: null` alone as public mode because existing flows use
  null to mean "resolve a matching connection by host."
- Do not persist public-session cookies or browser state.
- Do not allow unsafe URLs currently blocked by URL validation.

## Risks

- Public pages may still show cookie banners, geo-specific content, or bot
  defenses. This is acceptable and should be reflected in the captured evidence.
- Adding a new step field requires DB, DTO, API, UI, and execution changes to
  remain aligned.
- Legacy automations must continue to resolve connections as they do today.
- The step's profile is assumed to exist across nine call sites in the run and
  test paths. Any one missed does not fail loudly — connection resolution falls
  through to creating a BrowserAuthProfile for the public host, which is exactly
  the outcome this change is meant to prevent.
- Public mode is the first flow where an evidence URL comes from user input
  rather than from a server-created connection. Draft steps currently accept
  `targetUrl` with no URL validation at all, so they become an unvalidated
  request sink unless that gap is closed alongside this change.

