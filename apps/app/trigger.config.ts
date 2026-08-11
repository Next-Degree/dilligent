import { puppeteer } from '@trigger.dev/build/extensions/puppeteer';
import { defineConfig } from '@trigger.dev/sdk';
import { caBundleExtension } from './caBundleExtension';
import { prismaExtension } from './customPrismaExtension';

export default defineConfig({
  runtime: 'node-22',
  project: 'proj_pgcndrsfzokifeycvusi',
  logLevel: 'log',
  // PrismaInstrumentation was emitting a `prisma:client:operation` span for
  // every query, drowning out our own task logs. We rely on per-task
  // `logger.info` calls for observability instead — see e.g.
  // `link-risks-and-vendors-to-work.ts`.
  instrumentations: [],
  maxDuration: 300, // 5 minutes
  // NOTE: as of trigger.dev@4.5.10, this option is a no-op for `trigger deploy` —
  // commands/deploy.js never reads resolvedConfig.extraCACerts before building the
  // image (verified by reading the CLI source directly). Left set for when that gets
  // fixed upstream; the actual runtime NODE_EXTRA_CA_CERTS is set by
  // caBundleExtension() via a deploy.env layer, which trigger.dev does wire up.
  extraCACerts: './certs/prod-ca-2021.crt',
  build: {
    extensions: [
      caBundleExtension(),
      prismaExtension({
        version: '7.6.0',
        dbPackageVersion: '^2.0.0',
      }),
      puppeteer(),
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
  dirs: ['./src/jobs', './src/trigger'],
});
