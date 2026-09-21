# Fleet Device S3 Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Linux release publication and rename every device-agent storage setting to the `FLEET_DEVICE_S3_*` namespace.

**Architecture:** GitHub environments hold two secrets and four variables; an internal workflow output selects the appropriate environment. The publisher, API, and portal validate fleet-prefixed names, while the publisher maps credentials to AWS-standard process variables only at the AWS CLI boundary.

**Tech Stack:** GitHub Actions, Bash, Bun tests, TypeScript, Zod, AWS SDK v3, Neon Object Storage

## Global Constraints

- Never inspect `.env` files.
- Secrets: `FLEET_DEVICE_S3_ACCESS_KEY_ID`, `FLEET_DEVICE_S3_SECRET_ACCESS_KEY`.
- Variables: `FLEET_DEVICE_S3_REGION`, `FLEET_DEVICE_S3_ENDPOINT_URL`, `FLEET_DEVICE_S3_BUCKET`, `FLEET_DEVICE_S3_ENV`.
- `FLEET_DEVICE_S3_ENV` accepts only `staging` or `production`.
- Neon requires HTTPS and path-style S3 addressing.
- AppImage differential metadata is embedded; no standalone AppImage blockmap is required.

---

### Task 1: Match publisher preflight to electron-builder output

**Files:**
- Modify: `.github/scripts/upload-device-agent.test.ts`
- Modify: `.github/scripts/upload-device-agent.sh`

**Interfaces:**
- Consumes: electron-builder 25 Linux artifacts.
- Produces: a publisher that accepts AppImage, DEB, and `latest-linux.yml` without an AppImage blockmap.

- [ ] Add a test that omits `Dilligent-Device-Agent-1.2.3-x86_64.AppImage.blockmap` and expects publication to succeed.
- [ ] Run `bun test ./.github/scripts/upload-device-agent.test.ts --test-name-pattern "publishes an AppImage without"`; expect failure with status `1` instead of `0`.
- [ ] Remove the standalone AppImage blockmap from the preflight list and fixture artifact list.
- [ ] Update the expected transfer count from 21 to 20.
- [ ] Run `bun test ./.github/scripts/upload-device-agent.test.ts`; expect all tests to pass.

### Task 2: Rename the repository configuration contract

**Files:**
- Modify: `.github/scripts/upload-device-agent.test.ts`
- Modify: `.github/scripts/upload-device-agent.sh`
- Modify: `.github/workflows/device-agent-release.yml`
- Modify: `apps/api/src/device-agent/device-agent-storage.spec.ts`
- Modify: `apps/api/src/device-agent/device-agent-storage.ts`
- Modify: `apps/portal/src/utils/device-agent-storage.test.ts`
- Modify: `apps/portal/src/utils/device-agent-storage.ts`
- Modify: `packages/device-agent/RELEASE_STORAGE.md`
- Modify: `turbo.json`

**Interfaces:**
- Consumes: the six canonical names from the approved design.
- Produces: `{ bucket, environment, client }` from fleet-prefixed runtime configuration and a publisher that accepts only fleet-prefixed settings.

- [ ] Replace test fixtures and missing-setting assertions with the six canonical names; run targeted publisher, API, and portal tests and confirm they fail because production code still reads old names.
- [ ] Change the Bash preflight to validate all six names and construct the prefix from `FLEET_DEVICE_S3_BUCKET` and `FLEET_DEVICE_S3_ENV`.
- [ ] Invoke AWS CLI commands with `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` scoped from their fleet-prefixed equivalents, and pass `--endpoint-url "$FLEET_DEVICE_S3_ENDPOINT_URL"`.
- [ ] Change the release workflow to source secrets from `secrets.FLEET_DEVICE_S3_ACCESS_KEY_ID` and `secrets.FLEET_DEVICE_S3_SECRET_ACCESS_KEY` and all four non-secret values from matching `vars.*` names.
- [ ] Change API and portal Zod schemas and client construction to read only the six canonical names.
- [ ] Update non-environment documentation and Turbo passthrough names without opening any `.env` file.
- [ ] Run publisher, API, and portal tests, portal typechecking, targeted lint, shell syntax, and workflow lint.

### Task 3: Migrate GitHub environment configuration

**Files:**
- No repository files.

**Interfaces:**
- Consumes: Neon branch endpoint, region, bucket, and a fresh branch-scoped storage credential.
- Produces: complete `device-agent-staging` and `device-agent-production` GitHub environments under the canonical names.

- [ ] Set `FLEET_DEVICE_S3_REGION`, `FLEET_DEVICE_S3_ENDPOINT_URL`, `FLEET_DEVICE_S3_BUCKET`, and the matching `FLEET_DEVICE_S3_ENV` value in both environments.
- [ ] Create a fresh Neon storage credential and set its values as `FLEET_DEVICE_S3_ACCESS_KEY_ID` and `FLEET_DEVICE_S3_SECRET_ACCESS_KEY` in both environments without printing either value.
- [ ] Confirm variable values and secret names using `gh variable list` and `gh secret list`.
- [ ] Remove the superseded GitHub variable and secret names only after the new configuration is confirmed.
- [ ] Commit with hooks enabled and GPG signing disabled, then push PR branch `fix/device-agent-neon-storage`.
