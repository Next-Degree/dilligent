import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only the Docker build wants a standalone server; `next dev`/`next start` do not.
const isStandalone = process.env.NEXT_OUTPUT_STANDALONE === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@trycompai/ui',
    '@trycompai/design-system',
    '@trycompai/db',
    '@trycompai/company',
    'better-auth',
    '@noble/ciphers',
    '@noble/hashes',
  ],
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  // Workspace packages live outside apps/framework-editor, so file tracing has to
  // start at the repo root or standalone output drops them.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  ...(isStandalone
    ? {
        output: 'standalone',
      }
    : {}),
};

export default nextConfig;
