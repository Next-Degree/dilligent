import { describe, expect, it } from 'bun:test';
import { sslConnectionsCheck } from '../checks';
import { isNeonProxyHost } from '../checks/ssl-connections';
import { findByResourceId, httpError, makeEndpoint, makeNeonContext, makeProject } from './harness';

const project = makeProject({ id: 'prj-a', name: 'alpha' });

const run = async (endpoints: Parameters<typeof makeNeonContext>[0]['endpoints']) => {
  const recorded = makeNeonContext({ organizations: [], projects: [project], endpoints });
  await sslConnectionsCheck.run(recorded.ctx);
  return recorded;
};

describe('isNeonProxyHost', () => {
  it('accepts Neon-issued hostnames', () => {
    expect(isNeonProxyHost('ep-cool-darkness-123.us-east-2.aws.neon.tech', undefined)).toBe(true);
    expect(isNeonProxyHost('EP-Loud-Sun-9.eastus2.azure.neon.tech', undefined)).toBe(true);
  });

  it("accepts a host under the project's own proxy, for enterprise domains", () => {
    expect(isNeonProxyHost('ep-x.db.acme-corp.internal', 'db.acme-corp.internal')).toBe(true);
    expect(isNeonProxyHost('db.acme-corp.internal', 'db.acme-corp.internal')).toBe(true);
  });

  it('rejects a missing host and one that only looks like Neon', () => {
    expect(isNeonProxyHost(undefined, undefined)).toBe(false);
    expect(isNeonProxyHost('ep-x.neon.tech.evil.example', undefined)).toBe(false);
    expect(isNeonProxyHost('pgbouncer.internal', 'us-east-2.aws.neon.tech')).toBe(false);
  });
});

describe('sslConnectionsCheck', () => {
  it('passes when every live endpoint is served from a Neon proxy', async () => {
    const recorded = await run({
      'prj-a': [makeEndpoint({ id: 'ep-1' }), makeEndpoint({ id: 'ep-2', type: 'read_only' })],
    });

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.title).toBe('SSL connections enforced: alpha');
    expect(result?.evidence).toMatchObject({
      verification: 'provider-attested',
      endpointVerification: 'api-verified',
      liveEndpointCount: 2,
    });
    expect(recorded.fails).toHaveLength(0);
  });

  it('ignores disabled endpoints, which serve no connections', async () => {
    const recorded = await run({
      'prj-a': [
        makeEndpoint({ id: 'ep-1' }),
        makeEndpoint({ id: 'ep-off', host: 'legacy.example.com', disabled: true }),
      ],
    });

    expect(findByResourceId(recorded.passes, 'prj-a')).toBeDefined();
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails when a live endpoint is not on a recognised Neon proxy host', async () => {
    const recorded = await run({
      'prj-a': [makeEndpoint({ id: 'ep-1', host: 'pgbouncer.internal.example' })],
    });

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('Connection encryption unconfirmed: alpha');
    expect(failure?.evidence).toMatchObject({ unconfirmedEndpointIds: ['ep-1'] });
    expect(recorded.passes).toHaveLength(0);
  });

  it('passes a project with no computes yet, and says so', async () => {
    const recorded = await run({ 'prj-a': [] });

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.description).toContain('no live compute endpoints');
  });

  it('reports unconfirmed rather than encrypted when endpoints cannot be listed', async () => {
    const recorded = await run({ 'prj-a': httpError(403) });

    expect(findByResourceId(recorded.fails, 'prj-a')?.title).toBe(
      'Connection encryption unconfirmed: alpha',
    );
    expect(recorded.passes).toHaveLength(0);
  });

  it('records the project connection posture alongside the TLS result', async () => {
    const scoped = makeProject({
      id: 'prj-a',
      name: 'alpha',
      settings: { block_public_connections: true, allowed_ips: { ips: ['1.2.3.4'] } },
    });
    const recorded = makeNeonContext({
      organizations: [],
      projects: [scoped],
      endpoints: { 'prj-a': [makeEndpoint({ id: 'ep-1' })] },
    });
    await sslConnectionsCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'prj-a')?.evidence).toMatchObject({
      blockPublicConnections: true,
      allowedIpCount: 1,
    });
  });
});
