# Add Vendor Discovery from Google Workspace Login Access

## Why

When an employee signs into a third-party SaaS app with "Sign in with Google" using their
company email, that app becomes a vendor the company depends on — and nothing in the product
notices. Vendors are only ever added by hand or extracted by AI from onboarding answers, so the
vendor register drifts out of date the moment someone adopts a new tool.

Two gaps make this possible:

- **The Google Workspace integration never looks at OAuth grants.** It fetches users, roles,
  role assignments, and org units. There is no third-party app inventory.
- **Vendors have no discovery path and no per-person access model.** `Vendor` carries no
  provenance. The only Member↔Vendor link is `OffboardingAccessRevocation`, which records
  *revocation* rather than *access* — so the offboarding checklist presents every vendor in the
  organization for every leaver, because it has no way to know which ones they actually used.

The manual alternative — a monthly review in the Google Admin Console — is being shipped as
interim coverage, but it cannot replace this. It produces no data, so the register, offboarding,
and the employee access page are all unimproved by it; and the per-employee view is precisely
what is most painful to gather by hand, since it requires opening each user record individually.

## What Changes

- **New integration check** `oauth-app-access` on the Google Workspace manifest, collecting each
  in-scope user's authorized OAuth applications via the Admin SDK Directory Tokens API.
- **New OAuth scope** `admin.directory.user.security`, plus generic per-connection scope-drift
  detection so a connection missing consent reports "reconnect required" instead of failing.
- **New capability: vendor discovery.** Discovered apps become candidates in a review queue,
  resolved to known vendors deterministically where possible and by AI as a fallback. Approving
  a candidate creates a `Vendor`.
- **New capability: vendor access grants.** A first-class per-person `member ↔ vendor` access
  record, with observed first/last-seen and revocation tracking.
- **Offboarding is rewired** to list vendors the leaver actually has grants for, instead of the
  entire vendor register.
- **The employee detail page** gains an observed-SaaS-access section.

### Explicitly out of scope

- **Bulk approve.** Vendor risk assessment is globally serialized at `concurrencyLimit: 1`
  because the Firecrawl key is per-deployment; approving dozens of candidates at once would
  monopolize vendor research for every tenant.
- **Non-Google sign-ups.** An employee who registered with email + password using their company
  address is invisible to this signal. The UI must set that expectation.
- **Check-result retention.** Nothing in the repo prunes check runs today. This change is
  designed to keep its own row cardinality low (~20–200/run rather than ~10,000) but does not
  fix the underlying gap. Tracked separately.
- **`Vendor.assigneeId` cascade bug.** Deleting a Member currently deletes their assigned
  Vendors. Pre-existing; must not be replicated, fixed separately.

## Impact

- **Affected specs**: `google-workspace-integration` (modified), `vendor-discovery` (new),
  `vendor-access-grants` (new), `offboarding-access-revocation` (modified)
- **Database**: two new models (`DiscoveredVendorCandidate`, `VendorAccessGrant`), five new
  enums, two additive nullable/defaulted columns on `Vendor`. No backfill required.
- **Permissions**: none added. `vendor:read` / `vendor:create` / `vendor:update` cover the new
  surface, since a candidate is a pre-vendor and approving one creates a Vendor.
- **Background jobs**: one new daily schedule (`0 8 * * *`, after employee sync) and one new
  per-connection task.
- **Privacy**: this produces a per-employee list of every third-party app someone signed into
  with a work account. Requires product/legal review before EU tenants; note that auditors hold
  `vendor:read` and would see grantee lists.
