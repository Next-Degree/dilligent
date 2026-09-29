const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * Ad-hoc signs the packaged macOS app when no Developer ID certificate is configured.
 *
 * Why this exists: Electron ships an ad-hoc signed arm64 binary, but electron-builder
 * then renames the executable and rewrites Info.plist and the helper apps, which
 * invalidates that signature. With no identity, electron-builder skips signing
 * altogether, so the bundle ends up with a broken signature. Apple Silicon Gatekeeper
 * reports a quarantined app like that as "damaged and can't be opened" (no override
 * offered), instead of the recoverable "unidentified developer" prompt.
 *
 * This must run in afterPack: electron-builder skips afterSign when it did not sign.
 * A real certificate (CSC_LINK) re-signs everything afterwards, so we stay out of its way.
 */
function shouldAdHocSign({ electronPlatformName, platform, env }) {
  if (electronPlatformName !== 'darwin') return false;
  if (platform !== 'darwin') return false;
  return !env.CSC_LINK;
}

function adHocSign({ appPath, exec }) {
  exec('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  // Fail the build rather than ship a bundle Gatekeeper will call damaged.
  exec('codesign', ['--verify', '--deep', '--strict', appPath]);
}

const run = (file, args) => execFileSync(file, args, { stdio: 'inherit' });

exports.shouldAdHocSign = shouldAdHocSign;
exports.adHocSign = adHocSign;

/** electron-builder afterPack hook */
exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (!shouldAdHocSign({ electronPlatformName, platform: process.platform, env: process.env })) {
    return;
  }
  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  console.log(`No signing certificate configured, ad-hoc signing ${appPath}`);
  adHocSign({ appPath, exec: run });
};
