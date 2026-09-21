import type { SupportedOS } from './types';

const DOWNLOAD_TARGETS: Record<
  SupportedOS,
  { keySuffix: string; filename: string; contentType: string }
> = {
  macos: {
    keySuffix: 'macos/latest-arm64.dmg',
    filename: 'Dilligent-Device-Agent-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
  },
  'macos-intel': {
    keySuffix: 'macos/latest-x64.dmg',
    filename: 'Dilligent-Device-Agent-x64.dmg',
    contentType: 'application/x-apple-diskimage',
  },
  windows: {
    keySuffix: 'windows/latest-setup.exe',
    filename: 'Dilligent-Device-Agent-setup.exe',
    contentType: 'application/octet-stream',
  },
  linux: {
    keySuffix: 'linux/latest-amd64.deb',
    filename: 'Dilligent-Device-Agent-amd64.deb',
    contentType: 'application/vnd.debian.binary-package',
  },
};

export function getDownloadTarget({
  os,
  environment,
}: {
  os: SupportedOS;
  environment: 'staging' | 'production';
}) {
  const target = DOWNLOAD_TARGETS[os];
  return {
    ...target,
    key: `device-agent/${environment}/${target.keySuffix}`,
  };
}

// Backward-compatible filename exports used by client components.
export const MAC_APPLE_SILICON_FILENAME = DOWNLOAD_TARGETS.macos.filename;
export const MAC_INTEL_FILENAME = DOWNLOAD_TARGETS['macos-intel'].filename;
export const WINDOWS_FILENAME = DOWNLOAD_TARGETS.windows.filename;
export const LINUX_FILENAME = DOWNLOAD_TARGETS.linux.filename;
