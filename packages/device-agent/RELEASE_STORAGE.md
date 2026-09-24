# Device-agent releases on Neon Object Storage

The release workflow uploads installers and Electron update files to a private
Neon bucket. API and portal downloads use the same bucket, branch endpoint, and
release prefix. The AWS CLI/SDK remain the S3 protocol clients; these paths use
dedicated Neon credentials, independently of `APP_AWS_*` application storage.

## Configuration

The Dilligent deployment uses project `dilligent-pickle` (`odd-sun-25558956`),
branch `main` (`br-falling-bonus-av4bu18p`), in `us-east-1`. Its private bucket is
`dilligent-on-device-actor`, and its S3 endpoint is
`https://br-falling-bonus-av4bu18p.storage.c-11.us-east-1.aws.neon.tech`.
Production and staging use separate prefixes in this bucket.

Create these GitHub deployment environments:

- `device-agent-production`: used by pushes to `release`.
- `device-agent-staging`: used by all other release-workflow branches.

Configure each environment with its own complete set of values:

| Name                                | GitHub setting | API and portal environment variable    |
| ----------------------------------- | -------------- | -------------------------------------- |
| `FLEET_DEVICE_S3_ENDPOINT_URL`      | Variable       | Same name; Neon branch S3 endpoint     |
| `FLEET_DEVICE_S3_REGION`            | Variable       | Same name; region from Neon            |
| `FLEET_DEVICE_S3_BUCKET`            | Variable       | Same name; private release bucket      |
| `FLEET_DEVICE_S3_ENV`               | Variable       | Same name; `staging` or `production`   |
| `FLEET_DEVICE_S3_ACCESS_KEY_ID`     | Secret         | Same name; Neon credential `token_id`  |
| `FLEET_DEVICE_S3_SECRET_ACCESS_KEY` | Secret         | Same name; Neon `s3_secret_access_key` |

Set `FLEET_DEVICE_S3_ENV=production` or `staging` on **both API and portal** to
match the published prefix. Both builds currently use the same hosted API and
portal URLs, so choose the channel those deployments should serve explicitly.
Distinct staging and production deployments can use distinct Neon branches.

Use a branch-scoped Neon storage credential with **both** `storage:read` and
`storage:write` for CI and API presigned URLs. A live check on this project found
that `storage:write` alone returns 403 for reads/listing. The portal only
streams GET/HEAD requests and can use a separate `storage:read` credential.
Credentials must be valid on the branch named by the endpoint. Store credential
secrets when they are created; Neon only returns them once.

Missing settings or artifacts fail publication. Staging never falls back to
production credentials. The apps validate storage configuration on first access,
so builds and unrelated routes do not require release-storage secrets.

## Object layout and rollout

Under `device-agent/<production|staging>/`:

- `macos/`: versioned DMGs plus `latest-arm64.dmg` and `latest-x64.dmg`.
- `windows/`: versioned EXE plus `latest-setup.exe`.
- `linux/`: versioned DEB/AppImage plus `latest-amd64.deb` and `latest-x86_64.AppImage`.
- `updates/`: ZIP, EXE, AppImage, blockmap, and `latest*.yml` files.

The publisher validates the full artifact set, uploads versioned payloads,
updates installer aliases, then publishes update manifests last. A failed payload
upload never advertises an incomplete update. GitHub release attachments remain
available as well.

Before changing running API/portal settings, populate the Neon bucket with a
complete release (or copy the existing objects with the same keys). Keep any
older versioned payloads referenced by cached manifests or installed clients.
Then configure and deploy both readers. Verify portal installer downloads for
all platforms, API installer downloads, manifest GET/HEAD, and signed binary
GET/HEAD including range requests used by the updater. Existing agent update URLs
remain the portal proxy URLs; no client endpoint change is required.

The GitHub environments above are configured for this bucket with the named
`dilligent-device-agent-github-actions-read-write` Neon credential. On
2026-09-19, live checks passed for uploads, portal GET/HEAD, API presigned GET/HEAD,
range downloads, manifest streaming, and listing. Temporary test objects were
removed. The bucket had no release artifacts before these checks.

API and portal deployment settings still need to be applied before deploying
the reader changes. Provisioning CI does not switch running deployments or
populate the bucket with real installers; publish a complete release first.

## Local verification

```sh
bun test ./.github/scripts/upload-device-agent.test.ts
cd apps/api && bunx jest src/device-agent --runInBand
cd ../portal && bunx vitest run src/utils/device-agent-storage.test.ts src/app/api/download-agent/route.test.ts
```

References: [Neon authentication](https://neon.com/docs/storage/authentication),
[S3 compatibility](https://neon.com/docs/storage/s3-compatibility).
