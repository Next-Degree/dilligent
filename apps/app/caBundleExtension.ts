import type { BuildContext, BuildExtension, BuildManifest } from '@trigger.dev/build';
import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const BUNDLE_FILE_NAME = 'prod-ca-2021.crt';
const BUNDLE_DEST_REL = `certs/${BUNDLE_FILE_NAME}`;

function findBundleSrc(workingDir: string): string | undefined {
  // Walk up from workingDir to find the cert — handles both normal checkouts and git worktrees
  // where workspaceDir points to the main worktree root (wrong for us).
  const candidates = [
    resolve(workingDir, '../../packages/db/certs', BUNDLE_FILE_NAME),
    resolve(workingDir, 'packages/db/certs', BUNDLE_FILE_NAME),
    resolve(workingDir, '../packages/db/certs', BUNDLE_FILE_NAME),
  ];

  return candidates.find((c) => existsSync(c));
}

export function caBundleExtension(): BuildExtension {
  return {
    name: 'CABundleExtension',
    onBuildStart: (context) => {
      // trigger.config.ts's `extraCACerts` option is currently a no-op for managed
      // deploys: verified by reading trigger.dev@4.5.10's commands/deploy.js —
      // it builds the buildImage() options object without ever reading
      // resolvedConfig.extraCACerts, so the value never reaches the Docker build.
      // deploy.env is the mechanism trigger.dev actually wires up (it's how the
      // dashboard's env vars reach a deployed task), so set NODE_EXTRA_CA_CERTS here.
      context.addLayer({
        id: 'ca-bundle-env',
        deploy: {
          env: { NODE_EXTRA_CA_CERTS: `/app/${BUNDLE_DEST_REL}` },
          override: true,
        },
      });
    },
    onBuildComplete: async (context: BuildContext, manifest: BuildManifest) => {
      const src = findBundleSrc(context.workingDir);
      if (!src) {
        throw new Error(
          `CABundleExtension: ${BUNDLE_FILE_NAME} not found. Searched relative to ${context.workingDir}`,
        );
      }
      const dest = join(manifest.outputPath, BUNDLE_DEST_REL);
      await mkdir(dirname(dest), { recursive: true });
      await cp(src, dest);
      context.logger.log(`Copied database CA bundle to ${BUNDLE_DEST_REL}`);
    },
  };
}
