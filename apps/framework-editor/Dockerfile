# =============================================================================
# @trycompai/framework-editor — Next.js framework/control template editor
#
# Build context is the REPO ROOT, not apps/framework-editor: the build needs the
# whole workspace. On Railway, set Dockerfile Path to
# `apps/framework-editor/Dockerfile`, leave the build context at the repo root,
# and leave the build command EMPTY — a custom build command is ignored for
# Dockerfile builds, so `bun run --filter=... build` there does nothing.
#
# This app gets its own Dockerfile rather than a target in a shared one because
# Railway cannot select a build stage — it always builds the last stage in the
# file, so one file cannot serve several apps.
# =============================================================================

# =============================================================================
# STAGE 1: Dependencies
# =============================================================================
FROM oven/bun:1.3.4 AS deps

WORKDIR /app

# bunfig.toml pins linker=hoisted — without it, bun 1.3+ fails to symlink
# workspace packages into node_modules when only a subset of the workspaces
# glob is present on disk (as it is here), silently dropping @trycompai/*
# workspace deps and breaking every downstream package build.
COPY package.json bun.lock bunfig.toml ./

# Workspace packages apps/framework-editor needs: company, db and ui are declared
# in its package.json; tsconfig arrives via company, which extends
# @trycompai/tsconfig/base.json at build time.
COPY packages/company/package.json ./packages/company/
COPY packages/db/package.json ./packages/db/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/ui/package.json ./packages/ui/

COPY apps/framework-editor/package.json ./apps/framework-editor/

# Keep workspace postinstalls off in this sparse Docker context.
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true bun install --ignore-scripts

# =============================================================================
# STAGE 2: Builder
# =============================================================================
FROM deps AS builder

WORKDIR /app

COPY packages ./packages
COPY apps/framework-editor ./apps/framework-editor

# Workspace packages resolve through their package.json `exports`/`main`, which
# point at dist/ — only their own build script produces that. db goes first: its
# build generates the Prisma client into node_modules/@prisma/client, which
# company and ui import. (tsconfig exports straight from src/ — nothing to build.)
RUN cd packages/db && bun run build

# The deps stage only has package.json files for workspaces. Drop stale
# package-local workspace links from that sparse stage while keeping legitimate
# package-local external deps.
RUN find packages apps/framework-editor -path '*/node_modules/@trycompai/*' -mindepth 4 -maxdepth 4 -exec rm -rf {} +
RUN mkdir -p node_modules/@trycompai \
  && rm -rf node_modules/@trycompai/company \
    node_modules/@trycompai/db \
    node_modules/@trycompai/tsconfig \
    node_modules/@trycompai/ui \
  && ln -s ../../packages/company node_modules/@trycompai/company \
  && ln -s ../../packages/db node_modules/@trycompai/db \
  && ln -s ../../packages/tsconfig node_modules/@trycompai/tsconfig \
  && ln -s ../../packages/ui node_modules/@trycompai/ui

RUN cd packages/company && bun run build \
  && cd ../ui && bun run build

# NEXT_PUBLIC_* are inlined at build time, so they must be build args. Setting
# NEXT_PUBLIC_API_URL only as a runtime variable leaves the compiled bundle
# pointing at the http://localhost:3333 fallback in app/lib/api-client.ts.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=true \
    NODE_OPTIONS=--max_old_space_size=6144

# build:docker copies the model fragments from packages/db into
# apps/framework-editor/prisma/schema (only the generator/datasource stub is
# committed there) and generates the client before `next build`. No DATABASE_URL
# is needed: `prisma generate` never reads the connection string, and no runtime
# code in app/ touches the database — it all goes through the API.
RUN cd apps/framework-editor && bun run build:docker

# =============================================================================
# STAGE 3: Production runtime
#
# Last stage in the file, so it is what builds by default — no target needed.
# =============================================================================
FROM node:22-alpine AS production

WORKDIR /app

COPY --from=builder /app/apps/framework-editor/.next/standalone ./
COPY --from=builder /app/apps/framework-editor/.next/static ./apps/framework-editor/.next/static

# No NODE_EXTRA_CA_CERTS here, unlike app/portal: this app opens no database
# connection at runtime, it only calls the API over public TLS.
ENV NODE_ENV=production

# server.js honours $PORT (platforms like Railway inject it); 3000 is the default.
# If the Railway service pins a target port, set PORT to the same value.
EXPOSE 3000

CMD ["node", "apps/framework-editor/server.js"]
