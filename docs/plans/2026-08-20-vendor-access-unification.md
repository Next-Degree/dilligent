# Vendor Access Unification

**Status:** Proposal — no code changes
**Date:** 2026-08-20
**Branch:** `claude/google-workspace-login-sync-uqfog9`
**Companion:** PR #19 (vendor discovery from Google Workspace login access)

The vendor detail page will eventually show who can reach a vendor from two
independent sources. This records why they disagree, how the combined view
should read, and the two mistakes that are easy to make when building it.

Filed as a doc rather than a GitHub issue because Issues are disabled on this
repository.

## Finding

PR #19 adds `GET /v1/vendors/:id/access`, returning the members holding observed
`VendorAccessGrant` rows for a vendor. **Nothing in the app calls it.** The only
new access endpoint with a consumer is the per-person one
(`GET /v1/people/:memberId/vendor-access`), rendered by `EmployeeVendorAccess`
on the employee page.

So the vendor detail page still shows exactly one users list —
`VendorIntegrationUsers`, sourced from the vendor's own integration checks — and
there is no duplication today. The risk is latent.

The moment someone builds a "who has access" section on the vendor page using
the new endpoint, that page gets two user lists that legitimately disagree. For
a vendor that is both a connected integration and a Google sign-in target
(Slack, typically), you might see 42 people from the integration and 12 from
Google grants, with nothing explaining why.

PR #19 already fixed this class of confusion on the *employee* page, by naming
each card's source and saying outright that the counts can differ. The vendor
page has not had that treatment because the surface does not exist yet.

## Why the two lists differ

They answer different questions, and neither is a superset of the other.

| | Integration users | Access grants |
| --- | --- | --- |
| Question | Does the vendor's own system say this person has an account? | Did this person authorize the app with their work Google account? |
| Source | That vendor's `employee-access` check | Google Workspace OAuth token grants |
| Requires | An integration connected **for that vendor** | Only Google Workspace connected |
| Coverage | The 11 vendors with a code manifest | Every app anyone signed into with Google |
| Storage | Derived on read | Persisted rows |

They cannot collide at the data layer: `vendor-integration-loaders.ts` filters
`resourceType === 'user'`, and the discovery check emits only `oauth_app` and
`inventory` rows. That separation is deliberate and should be preserved — it is
also what keeps `people-access.service.ts` and the People-page 2FA column
unaffected by discovery.

## Recommendation

One list per vendor, unioned on `memberId`, with a column per source.

### Do not frame the columns as pass/fail

The obvious reading — "both ticks means good, one tick means a problem" — is
wrong, and would make the view cry wolf on the most common state.

| Integration | Google grant | Meaning | Problem? |
| --- | --- | --- | --- |
| ✓ | ✓ | Has an account, got in via Google | No |
| ✓ | — | Has an account, signed in another way (password, SAML) | **No — the common case** |
| — | ✓ | Authorized via Google, absent from the vendor's user list | **Worth a look** |

Most people in most tools signed up with a password or a non-Google SSO. Under a
"both = good" rubric that entirely normal row renders as half-failed, reviewers
learn the column is noise, and it stops being read.

The useful framing is that the grant column reports **how someone got in**, not
a second opinion on whether they have access. Row 3 is where the signal is: it
can be dull (the integration reports no per-person data) or genuinely
interesting — access the vendor's official user list does not know about.

### Each column needs three states, not two

Same principle as the reconciliation trust predicate in PR #19: absence of
evidence is not evidence of absence.

- Integration not connected → `Not connected`, **not** `✗`
- Google Workspace not connected, or the `admin.directory.user.security` scope
  not consented → `Not observed`, **not** `✗`

An em-dash where we cannot see is honest. An ✗ where we cannot see reads as
"this person does not have access", which is a lie the reader has no way to
detect.

### Sketch

```
Slack · 42 people with access
Sources: Slack integration (synced 2h ago) · Google sign-in (synced today 08:00)

 PERSON                  SLACK ACCOUNT    GOOGLE SIGN-IN   NOTE
 ─────────────────────────────────────────────────────────────────────────────
 Ana Ruiz                ✓ Member         ✓ Authorized
 Ben Cole                ✓ Admin          —                Signs in another way
 Priya Shah              ✓ Member         —                Signs in another way
 Tom Ek                  —                ✓ Authorized     ⚠ Not in Slack's user list
 Dana Lee (offboarded)   ✓ Member         ⚠ Reappeared     ⚠ Revoked 12 Aug, seen again
 ─────────────────────────────────────────────────────────────────────────────
 Showing 5 of 42
```

And where a source cannot see:

```
 PERSON        SLACK ACCOUNT           GOOGLE SIGN-IN
 ──────────────────────────────────────────────────────
 Ana Ruiz      Not connected           ✓ Authorized
 Ben Cole      Not connected           ✓ Authorized
              ↑ connect Slack to see account-level access
```

Only two conditions earn a warning: **a grant with no corresponding account**
(possible shadow access) and **access that reappeared after an offboarding
revocation**. Keeping the warning budget small is what makes a warning mean
something.

## Constraints for whoever builds this

1. **The two sides cannot contribute the same row set.** Integration users are
   matched by email and *can* include non-members — the existing code has a
   "Not a member" badge for external accounts. Grants match on Google `userKey`
   first, then email, and unmatched grantees are dropped (counted, not shown).
   Union on `memberId` and external contractor accounts appear with a
   permanently blank grant column, which must render as **n/a**, not "no".

2. **The sources sync on different schedules.** Integration checks run at 06:00;
   vendor discovery runs at 08:00 and only against connected Google Workspace
   tenants. Presenting two columns as a single snapshot when one is 2 hours
   stale and the other 14 is its own quiet inaccuracy — hence per-source
   timestamps in the header rather than one "last updated".

3. **Copy must say "authorized", never "used".** The Google Tokens API carries
   no last-used timestamp. PR #19 holds this line in every surface it touches
   and it should not slip here.

## Scope

Not blocking PR #19. This needs a vendor-page section that does not exist yet,
and that PR is already at 92 files. Suggest a separate PR.
