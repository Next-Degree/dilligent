// Defaults so auth.server can be constructed in better-auth-routes.test.ts.
// Construction reads these but makes no network or database calls.
process.env.SECRET_KEY ??= 'route-check-secret-0123456789abcdef';
process.env.DATABASE_URL ??=
  'postgresql://user:pass@localhost:5432/route_check';
process.env.UPSTASH_REDIS_REST_URL ??= 'https://route-check.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN ??= 'route-check';
