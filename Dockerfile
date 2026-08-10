# =============================================================================
# Migrator / seeder image
#
# The app and portal builds live in apps/app/Dockerfile and
# apps/portal/Dockerfile — they each need their own file because Railway cannot
# select a build stage and always builds the last one, so a shared file with
# `target: app` / `target: portal` cannot serve both.
# =============================================================================
FROM oven/bun:1.2.8 AS migrator

WORKDIR /app

# Copy local Prisma schema and migrations from workspace
COPY packages/db/prisma ./packages/db/prisma

# Create minimal package.json for Prisma runtime (also used by seeder)
RUN echo '{"name":"migrator","type":"module","dependencies":{"prisma":"^6.14.0","@prisma/client":"^6.14.0","@trycompai/db":"^1.3.4","zod":"^3.25.7"}}' > package.json

# Install ONLY Prisma dependencies
RUN bun install

# Ensure Prisma can find migrations relative to the published schema path
# We copy the local migrations into the published package's dist directory
RUN cp -R packages/db/prisma/migrations node_modules/@trycompai/db/dist/

# Run migrations against the combined schema published by @trycompai/db
RUN echo "Running migrations against @trycompai/db combined schema"
CMD ["bunx", "prisma", "migrate", "deploy", "--schema=node_modules/@trycompai/db/dist/schema.prisma"]
