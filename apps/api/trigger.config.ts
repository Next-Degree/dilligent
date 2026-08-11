import { defineConfig } from '@trigger.dev/sdk';
import { caBundleExtension } from './caBundleExtension';
import { prismaExtension } from './customPrismaExtension';
import { emailExtension } from './emailExtension';
import { integrationPlatformExtension } from './integrationPlatformExtension';

export default defineConfig({
  runtime: 'node-22',
  project: 'proj_kmfzoqeidtxikiewbwzj', // API project
  logLevel: 'log',
  maxDuration: 300, // 5 minutes
  // NOTE: as of trigger.dev@4.5.10, this option is a no-op for `trigger deploy` —
  // commands/deploy.js never reads resolvedConfig.extraCACerts before building the
  // image (verified by reading the CLI source directly). Left set for when that gets
  // fixed upstream; the actual runtime NODE_EXTRA_CA_CERTS is set by
  // caBundleExtension() via a deploy.env layer, which trigger.dev does wire up.
  extraCACerts: './certs/prod-ca-2021.crt',
  build: {
    // The 1Password SDK ships a native WASM core; keep it external so it's
    // resolved from node_modules at runtime instead of being bundled by esbuild.
    external: ['@1password/sdk'],
    extensions: [
      caBundleExtension(),
      prismaExtension({
        version: '7.6.0',
        dbPackageVersion: '^2.0.0',
      }),
      integrationPlatformExtension(),
      emailExtension(),
    ],
  },
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ['./src/trigger'],
});
