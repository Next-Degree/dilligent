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
  // Baked into the deployed image's Dockerfile ENV at build time (via trigger.dev's
  // --build-arg), so it's present before the container process even starts — unlike
  // caBundleExtension's old deploy.env layer, which relied on trigger.dev's orchestrator
  // injecting it into an already-running worker process, racing Node's TLS init.
  // Path is relative to the build output root; caBundleExtension() copies the cert here.
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
