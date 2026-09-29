import path from 'path';

const config = {
  transpilePackages: ['@trycompai/design-system', '@carbon/icons-react'],
  images: {
    remotePatterns: [{ protocol: 'https' as const, hostname: '**' }],
  },
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default config;
