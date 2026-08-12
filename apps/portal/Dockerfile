# =============================================================================
# @trycompai/portal — Next.js employee/trust portal
#
# Build context is the REPO ROOT, not apps/portal: the build needs the whole
# workspace. On Railway, set Dockerfile Path to `apps/portal/Dockerfile` and
# leave the build context at the repo root. Locally, `docker compose build portal`.
#
# This app gets its own Dockerfile rather than a target in a shared one because
# Railway cannot select a build stage — it always builds the last stage in the
# file, so one file cannot serve both app and portal.
# =============================================================================

# =============================================================================
# STAGE 1: Dependencies
# =============================================================================
FROM oven/bun:1.3.4 AS deps

WORKDIR /app

COPY package.json bun.lock ./

# Workspace packages apps/portal needs: analytics, auth, company, db, email, kv
# and ui are declared in its package.json; tsconfig arrives via auth, utils via
# email, db via company.
COPY packages/analytics/package.json ./packages/analytics/
COPY packages/auth/package.json ./packages/auth/
COPY packages/company/package.json ./packages/company/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/kv/package.json ./packages/kv/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/ui/package.json ./packages/ui/
COPY packages/utils/package.json ./packages/utils/

COPY apps/portal/package.json ./apps/portal/

# Keep workspace postinstalls off in this sparse Docker context.
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true bun install --ignore-scripts

# =============================================================================
# STAGE 2: Builder
# =============================================================================
FROM deps AS builder

WORKDIR /app

COPY packages ./packages
COPY apps/portal ./apps/portal

# Workspace packages resolve through their package.json `exports`/`main`, which
# point at dist/ — only their own build script produces that. db goes first:
# its build generates the Prisma client
# into node_modules/@prisma/client, which company and the portal itself import.
# (utils and tsconfig export straight from src/ — nothing to build.)
RUN cd packages/db && bun run build

# The deps stage only has package.json files for workspaces. Drop stale
# package-local workspace links from that sparse stage while keeping legitimate
# package-local external deps such as resend.
RUN find packages apps/portal -path '*/node_modules/@trycompai/*' -mindepth 4 -maxdepth 4 -exec rm -rf {} +
RUN mkdir -p node_modules/@trycompai \
  && rm -rf node_modules/@trycompai/analytics \
    node_modules/@trycompai/auth \
    node_modules/@trycompai/company \
    node_modules/@trycompai/db \
    node_modules/@trycompai/email \
    node_modules/@trycompai/kv \
    node_modules/@trycompai/tsconfig \
    node_modules/@trycompai/ui \
    node_modules/@trycompai/utils \
  && ln -s ../../packages/analytics node_modules/@trycompai/analytics \
  && ln -s ../../packages/auth node_modules/@trycompai/auth \
  && ln -s ../../packages/company node_modules/@trycompai/company \
  && ln -s ../../packages/db node_modules/@trycompai/db \
  && ln -s ../../packages/email node_modules/@trycompai/email \
  && ln -s ../../packages/kv node_modules/@trycompai/kv \
  && ln -s ../../packages/tsconfig node_modules/@trycompai/tsconfig \
  && ln -s ../../packages/ui node_modules/@trycompai/ui \
  && ln -s ../../packages/utils node_modules/@trycompai/utils

RUN cd packages/company && bun run build \
  && cd ../auth && bun run build \
  && cd ../email && bun run build \
  && cd ../kv && bun run build \
  && cd ../ui && bun run build \
  && cd ../analytics && bun run build

# apps/portal/prisma/schema holds only a committed stub (generator + datasource);
# the model fragments are gitignored. build:docker runs `prisma generate
# --schema=prisma/schema` against that directory, so without this copy the
# generated client has zero models. Mirrors apps/portal's own db:getschema script.
RUN printf 'generator client {\n  provider        = "prisma-client"\n  output          = "../../src/generated/prisma"\n  previewFeatures = ["postgresqlExtensions"]\n}\n\ndatasource db {\n  provider   = "postgresql"\n  extensions = [pgcrypto]\n}\n' > apps/portal/prisma/schema/schema.prisma \
  && find apps/portal/prisma/schema -name '*.prisma' ! -name 'schema.prisma' -delete \
  && find packages/db/prisma/schema -name '*.prisma' ! -name 'schema.prisma' -exec cp {} apps/portal/prisma/schema/ \;

# NEXT_PUBLIC_* are inlined at build time, so they must be build args.
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ENV NEXT_PUBLIC_BETTER_AUTH_URL=$NEXT_PUBLIC_BETTER_AUTH_URL \
    NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=true \
    NODE_OPTIONS=--max_old_space_size=6144

RUN cd apps/portal \
  && MOCK_REDIS=true \
    APP_AWS_REGION=us-east-1 \
    APP_AWS_ACCESS_KEY_ID=build-placeholder \
    APP_AWS_SECRET_ACCESS_KEY=build-placeholder \
    FLEET_AGENT_BUCKET_NAME=build-placeholder \
    SKIP_ENV_VALIDATION=true \
    bun run build:docker

# =============================================================================
# STAGE 3: Production runtime
#
# Last stage in the file, so it is what builds by default — no target needed.
# =============================================================================
FROM node:22-alpine AS production

WORKDIR /app

COPY --from=builder /app/apps/portal/.next/standalone ./
COPY --from=builder /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=builder /app/apps/portal/public ./apps/portal/public

ENV NODE_ENV=production

# server.js honours $PORT (platforms like Railway inject it); 3000 is the default.
EXPOSE 3000

CMD ["node", "apps/portal/server.js"]
