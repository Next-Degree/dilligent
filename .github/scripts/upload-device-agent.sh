#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

# Missing Neon settings must fail instead of uploading to AWS or skipping publication.
for name in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION AWS_ENDPOINT_URL_S3 S3_BUCKET VERSION S3_ENV; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Missing device-agent storage setting: ${name}"
    exit 1
  fi
done
[[ "$AWS_ENDPOINT_URL_S3" == https://* ]] || { echo '::error::Storage endpoint must use HTTPS'; exit 1; }
[[ "$S3_ENV" == production || "$S3_ENV" == staging ]] || { echo '::error::Invalid release environment'; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo '::error::Invalid release version'; exit 1; }

artifact_dir="${ARTIFACT_DIR:-artifacts}"
prefix="s3://${S3_BUCKET}/device-agent/${S3_ENV}"
base="Dilligent-Device-Agent-${VERSION}"
installers=("${base}-arm64.dmg" "${base}-x64.dmg" "${base}-setup.exe" "${base}-amd64.deb" "${base}-x86_64.AppImage")
targets=("macos/latest-arm64.dmg" "macos/latest-x64.dmg" "windows/latest-setup.exe" "linux/latest-amd64.deb" "linux/latest-x86_64.AppImage")

# Validate the entire release before changing any remote object.
for file in \
  "${installers[@]}" \
  "${base}-arm64.zip" \
  "${base}-x64.zip" \
  "${base}-arm64.zip.blockmap" \
  "${base}-x64.zip.blockmap" \
  "${base}-setup.exe.blockmap" \
  "${base}-x86_64.AppImage.blockmap" \
  latest-mac.yml \
  latest.yml \
  latest-linux.yml; do
  [[ -s "${artifact_dir}/${file}" ]] || { echo "::error::Missing or empty artifact: ${file}"; exit 1; }
done

aws configure set default.s3.addressing_style path
export AWS_EC2_METADATA_DISABLED=true
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

upload() {
  aws --endpoint-url "$AWS_ENDPOINT_URL_S3" s3 cp "$1" "$2" --only-show-errors --cache-control "$3"
}

# Staging builds reuse the next production version until that version is tagged.
payload_cache='no-cache'
if [[ "$S3_ENV" == production ]]; then
  payload_cache='public, max-age=31536000, immutable'
fi

# Versioned installers and updater payloads are available before latest pointers.
for i in "${!installers[@]}"; do
  platform="${targets[$i]%%/*}"
  upload "${artifact_dir}/${installers[$i]}" "${prefix}/${platform}/${installers[$i]}" "$payload_cache"
done
for file in "$artifact_dir"/*.zip "$artifact_dir"/*.blockmap "$artifact_dir"/*.exe "$artifact_dir"/*.AppImage; do
  upload "$file" "${prefix}/updates/$(basename "$file")" "$payload_cache"
done

for i in "${!installers[@]}"; do
  upload "${artifact_dir}/${installers[$i]}" "${prefix}/${targets[$i]}" 'no-cache'
done

# Publish manifests last: a failed binary upload must never advertise that update.
for file in "$artifact_dir"/*.yml; do
  upload "$file" "${prefix}/updates/$(basename "$file")" 'no-cache'
done

aws --endpoint-url "$AWS_ENDPOINT_URL_S3" s3 ls "${prefix}/updates/"
