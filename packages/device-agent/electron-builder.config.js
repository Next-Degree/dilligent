// Use a space-free product name for Linux to avoid path issues
const isLinuxBuild =
  process.argv.includes('--linux') || process.env.BUILD_TARGET === 'linux';

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'ai.dilligent.device-agent',
  productName: isLinuxBuild ? 'dilligent-device-agent' : 'Dilligent',
  directories: {
    buildResources: 'assets',
    output: 'release',
  },
  asar: true,
  // electron-builder shells out to the package manager named by npm_execpath to
  // rebuild native modules. Under bun that path is a binary, and electron-builder
  // runs it as `node <path>`, which dies parsing the ELF header. Every runtime
  // dependency here is pure JavaScript, so skip the rebuild entirely. Adding a
  // native dependency means solving that incompatibility before flipping this back.
  npmRebuild: false,
  files: [
    'dist/main/**/*',
    'dist/preload/**/*',
    'dist/renderer/**/*',
    'assets/**/*',
    '!node_modules/**/{test,tests,__tests__,spec}/**',
    '!node_modules/**/*.{md,ts,map}',
    '!node_modules/**/{.github,.vscode}/**',
  ],
  electronLanguages: ['en-US'],
  extraResources: [
    {
      from: 'assets/',
      to: 'assets/',
      filter: ['**/*.png'],
    },
  ],
  icon: 'assets/icon.png',
  mac: {
    category: 'public.app-category.utilities',
    icon: 'assets/icon.icns',
    artifactName: 'Dilligent-Device-Agent-${version}-${arch}.${ext}',
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'zip',
        arch: ['x64', 'arm64'],
      },
    ],
    hardenedRuntime: true,
    entitlements: 'assets/entitlements.mac.plist',
    entitlementsInherit: 'assets/entitlements.mac.plist',
  },
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: true,
    allowToChangeInstallationDirectory: false,
    artifactName: 'Dilligent-Device-Agent-${version}-setup.${ext}',
    deleteAppDataOnUninstall: true,
  },
  linux: {
    target: [
      {
        target: 'AppImage',
        arch: ['x64'],
      },
      {
        target: 'deb',
        arch: ['x64'],
      },
    ],
    category: 'Utility',
    artifactName: 'Dilligent-Device-Agent-${version}-${arch}.${ext}',
    executableName: 'dilligent-device-agent',
  },
  deb: {
    afterInstall: 'assets/linux/after-install.sh',
    afterRemove: 'assets/linux/after-remove.sh',
    packageName: 'dilligent-device-agent',
    compression: 'xz',
  },
  publish: {
    provider: 'generic',
    url: process.env.AUTO_UPDATE_URL || 'https://dilligent-portal.withpickle.dev/api/device-agent/updates',
  },
};
