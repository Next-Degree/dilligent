# @trycompai/trust

Public, server-rendered trust center. It reads everything from the public
`/v1/trust-access` endpoints of `apps/api`; it has no database access and no
auth of its own.

## How portals are resolved

- Platform host (`TRUST_PLATFORM_HOSTS`): path based, `/<friendlyUrl>`.
- Any other host is a customer custom domain. `src/proxy.ts` asks
  `GET /v1/trust-access/resolve-domain?domain=` and rewrites to that portal, so one
  deployment serves every organization.

## Pages

| Route                           | Purpose                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `/[friendlyUrl]`                | Overview, frameworks, policies, controls, subprocessors, links, FAQ, request access |
| `/[friendlyUrl]/access/[token]` | Token gated downloads (link from the approval email)                                |
| `/nda/[token]`                  | NDA preview and signing (link from the NDA email)                                   |
| `/api/trust/[...path]`          | Allowlisted server proxy for the browser forms (`src/lib/proxy-allowlist.ts`)       |

## Configuration

See `.env.example`. On the API side set `TRUST_APP_URL` to this app's public URL
(used in email links) and `TRUST_PORTAL_PROJECT_ID` to this app's Vercel project
(used for custom domain provisioning).

## Develop

```bash
bun run --filter '@trycompai/trust' dev   # http://localhost:3008/<friendlyUrl>
cd apps/trust && npx vitest run
```

Design-system components are imported through `src/components/ds.tsx`, a client
boundary that keeps the design-system barrel out of Server Components.
