# =============================================================================
# @trycompai/app — Next.js dashboard
#
# Build context is the REPO ROOT, not apps/app: the build needs the whole
# workspace. On Railway, set Dockerfile Path to `apps/app/Dockerfile` and leave
# the build context at the repo root. Locally, `docker compose build app`.
#
# This app gets its own Dockerfile rather than a target in a shared one because
# Railway cannot select a build stage — it always builds the last stage in the
# file, so one file cannot serve both app and portal.
# =============================================================================

# =============================================================================
# STAGE 1: Dependencies
# =============================================================================
FROM oven/bun:1.2.8 AS deps

WORKDIR /app

COPY package.json bun.lock ./

# Workspace packages apps/app needs. analytics, integrations, kv, ui and utils
# are imported from apps/app source but not declared in its package.json (they
# resolve via workspace hoisting), so they have to be listed here too. tsconfig
# arrives via auth/billing, utils via email, db via company.
COPY packages/analytics/package.json ./packages/analytics/
COPY packages/auth/package.json ./packages/auth/
COPY packages/billing/package.json ./packages/billing/
COPY packages/company/package.json ./packages/company/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/integration-platform/package.json ./packages/integration-platform/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/kv/package.json ./packages/kv/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/ui/package.json ./packages/ui/
COPY packages/utils/package.json ./packages/utils/

COPY apps/app/package.json ./apps/app/

RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true bun install --ignore-scripts

# =============================================================================
# STAGE 2: Builder
# =============================================================================
FROM deps AS builder

WORKDIR /app

COPY packages ./packages
COPY apps/app ./apps/app

# COPY above replaces directories, wiping the workspace symlinks the deps stage
# installed — bring root node_modules back.
COPY --from=deps /app/node_modules ./node_modules

# Workspace packages resolve through their package.json `exports`/`main`, which
# point at dist/ — only their own build script produces that, and deps installed
# with --ignore-scripts. db goes first: its build generates the Prisma client
# into node_modules/@prisma/client, which company and the app itself import.
# (integrations, utils and tsconfig export straight from src/ — nothing to build.)
RUN cd packages/db && bun run build
RUN cd packages/company && bun run build \
  && cd ../auth && bun run build \
  && cd ../billing && bun run build \
  && cd ../integration-platform && bun run build \
  && cd ../email && bun run build \
  && cd ../kv && bun run build \
  && cd ../ui && bun run build \
  && cd ../analytics && bun run build

# apps/app/prisma/schema holds only a committed stub (generator + datasource);
# the model fragments are gitignored. build:docker runs `prisma generate
# --schema=prisma/schema` against that directory, so without this copy the
# generated client has zero models. Mirrors apps/app's own db:getschema script.
RUN find packages/db/prisma/schema -name '*.prisma' ! -name 'schema.prisma' -exec cp {} apps/app/prisma/schema/ \;

# NEXT_PUBLIC_* are inlined at build time, so they must be build args.
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ARG NEXT_PUBLIC_PORTAL_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_IS_DUB_ENABLED
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_BETTER_AUTH_URL=$NEXT_PUBLIC_BETTER_AUTH_URL \
    NEXT_PUBLIC_PORTAL_URL=$NEXT_PUBLIC_PORTAL_URL \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_IS_DUB_ENABLED=$NEXT_PUBLIC_IS_DUB_ENABLED \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=true \
    NODE_OPTIONS=--max_old_space_size=6144

RUN cd apps/app && SKIP_ENV_VALIDATION=true bun run build:docker

# =============================================================================
# STAGE 3: Production runtime
#
# Last stage in the file, so it is what builds by default — no target needed.
# =============================================================================
FROM node:22-alpine AS production

WORKDIR /app

COPY --from=builder /app/apps/app/.next/standalone ./
COPY --from=builder /app/apps/app/.next/static ./apps/app/.next/static
COPY --from=builder /app/apps/app/public ./apps/app/public

ENV NODE_ENV=production

# server.js honours $PORT (platforms like Railway inject it); 3000 is the default.
EXPOSE 3000

CMD ["node", "apps/app/server.js"]
