# Fleet Device S3 Environment Naming

## Goal

Use one explicit namespace for device-agent release storage across GitHub Actions,
the upload script, the API, and the portal.

## Canonical settings

| Name | GitHub classification | Source |
| --- | --- | --- |
| `FLEET_DEVICE_S3_ACCESS_KEY_ID` | Secret | Neon storage credential |
| `FLEET_DEVICE_S3_SECRET_ACCESS_KEY` | Secret | Neon storage credential |
| `FLEET_DEVICE_S3_REGION` | Variable | Neon branch storage region |
| `FLEET_DEVICE_S3_ENDPOINT_URL` | Variable | Neon branch storage endpoint |
| `FLEET_DEVICE_S3_BUCKET` | Variable | Device-agent release bucket |
| `FLEET_DEVICE_S3_ENV` | Variable | `staging` or `production` release channel |

The API and portal consume the same six names from their runtime configuration.

## GitHub Actions flow

The release workflow selects the `device-agent-staging` or
`device-agent-production` GitHub environment. The access key and secret key come
from environment secrets. Region, endpoint URL, and bucket come from environment
variables. An internal release-channel output selects the matching GitHub
environment, whose `FLEET_DEVICE_S3_ENV` value is passed to the publisher.

The upload script validates all six fleet-prefixed settings. Only when invoking
the AWS CLI does it map the credential and region values to the AWS-standard
process variables required by that CLI. No AWS-prefixed setting is part of the
repository's public configuration contract.

## Application flow

The API and portal validate the same names, require an HTTPS endpoint, require
the release channel to be `staging` or `production`, and construct an S3 client
with path-style addressing for Neon Object Storage.

## Migration

1. Add the new variables to both GitHub environments.
2. Provision a fresh Neon credential under the new secret names because GitHub
   does not allow reading or renaming an existing secret value.
3. Update workflow, script, API, portal, tests, and documentation references.
4. Verify publishing and download tests.
5. Remove the superseded GitHub variable and secret names after the new names
   are confirmed.

Runtime deployment configuration for the API and portal must use the canonical
names before the renamed application code is deployed.

## Testing

- Publisher tests provide only the fleet-prefixed names and assert uploads still
  target the Neon endpoint and bucket.
- Publisher tests assert each missing canonical setting fails before any upload.
- API and portal storage tests assert successful signing and missing/invalid
  setting failures using only the canonical names.
- Workflow lint, shell syntax, TypeScript, lint, and targeted test suites remain
  green.
