import { describe, expect, it } from 'bun:test';
import { tlsDomainsCheck } from '../checks';
import { parseWarningDays } from '../checks/tls-domains';
import type { RailwayCustomDomain } from '../types';
import {
  WORKSPACE,
  daysFromNow,
  findByResourceId,
  makeCustomDomain,
  makeEnvironment,
  makeInstance,
  makeProject,
  makeRailwayContext,
} from './harness';

const runWith = async (
  domains: {
    customDomains?: RailwayCustomDomain[];
    serviceDomains?: { id: string; domain: string }[];
  },
  variables?: Record<string, number>,
) => {
  const instance = makeInstance({
    serviceId: 'api',
    domains: {
      customDomains: domains.customDomains ?? [],
      serviceDomains: domains.serviceDomains ?? [],
    },
  });
  const recorded = makeRailwayContext(
    {
      tokenWorkspaces: [WORKSPACE],
      projectPages: {
        [WORKSPACE.id]: [
          {
            projects: [
              makeProject({ id: 'p1' }, [makeEnvironment({ id: 'env-prod' }, [instance])]),
            ],
          },
        ],
      },
    },
    variables,
  );
  await tlsDomainsCheck.run(recorded.ctx);
  return recorded;
};

describe('tlsDomainsCheck', () => {
  it('passes a custom domain with a valid certificate well before expiry', async () => {
    const recorded = await runWith({
      customDomains: [makeCustomDomain({ id: 'cd1', domain: 'app.acme.com' })],
    });

    const result = findByResourceId(recorded.passes, 'cd1');
    expect(result?.title).toBe('Valid TLS certificate: app.acme.com');
    expect(result?.evidence).toMatchObject({
      verification: 'api-verified',
      domain: 'app.acme.com',
    });
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails a certificate inside the warning window, and an expired one at high severity', async () => {
    const soon = makeCustomDomain({
      id: 'soon',
      domain: 'soon.acme.com',
      certificates: [
        { domainNames: ['soon.acme.com'], expiresAt: daysFromNow(5), keyType: 'KEY_TYPE_ECDSA' },
      ],
    });
    const expired = makeCustomDomain({
      id: 'old',
      domain: 'old.acme.com',
      certificates: [
        { domainNames: ['old.acme.com'], expiresAt: daysFromNow(-2), keyType: 'KEY_TYPE_ECDSA' },
      ],
    });
    const recorded = await runWith({ customDomains: [soon, expired] });

    expect(findByResourceId(recorded.fails, 'soon')?.severity).toBe('medium');
    expect(findByResourceId(recorded.fails, 'old')?.severity).toBe('high');
  });

  it('honours the configured warning window', async () => {
    const recorded = await runWith(
      { customDomains: [makeCustomDomain({ id: 'cd1', domain: 'app.acme.com' })] },
      { expiry_warning_days: 90 },
    );

    expect(findByResourceId(recorded.fails, 'cd1')?.title).toBe(
      'Certificate expiring: app.acme.com',
    );
  });

  it('does not pass a VALID status with no expiry date', async () => {
    const recorded = await runWith({
      customDomains: [makeCustomDomain({ id: 'cd1', domain: 'app.acme.com', certificates: [] })],
    });

    expect(findByResourceId(recorded.fails, 'cd1')?.title).toBe(
      'Certificate expiry unknown: app.acme.com',
    );
  });

  it('fails a domain whose certificate failed to issue, at high severity', async () => {
    const recorded = await runWith({
      customDomains: [
        makeCustomDomain({
          id: 'cd1',
          domain: 'app.acme.com',
          certificateStatus: 'CERTIFICATE_STATUS_TYPE_ISSUE_FAILED',
          certificateErrorMessage: 'DNS validation failed',
          certificates: [],
        }),
      ],
    });

    const finding = findByResourceId(recorded.fails, 'cd1');
    expect(finding?.title).toBe('No valid certificate: app.acme.com');
    expect(finding?.severity).toBe('high');
    expect(finding?.description).toContain('DNS validation failed');
  });

  it('flags a certificate still issuing at medium severity', async () => {
    const recorded = await runWith({
      customDomains: [
        makeCustomDomain({
          id: 'cd1',
          domain: 'app.acme.com',
          certificateStatus: 'CERTIFICATE_STATUS_TYPE_ISSUING',
          certificates: [],
        }),
      ],
    });

    expect(findByResourceId(recorded.fails, 'cd1')?.severity).toBe('medium');
  });

  it('reports a CDN-proxied domain as unverified rather than passing or failing hard', async () => {
    const recorded = await runWith({
      customDomains: [
        makeCustomDomain({
          id: 'cd1',
          domain: 'app.acme.com',
          certificateStatus: 'CERTIFICATE_STATUS_TYPE_ISSUING',
          cdnProvider: 'DETECTED_CDN_PROVIDER_CLOUDFLARE',
          certificates: [],
        }),
      ],
    });

    const finding = findByResourceId(recorded.fails, 'cd1');
    expect(finding?.title).toBe('TLS terminated at CDN, unverified: app.acme.com');
    expect(finding?.severity).toBe('medium');
  });

  it('records Railway-generated domains as provider-attested, never api-verified', async () => {
    const recorded = await runWith({
      serviceDomains: [{ id: 'sd1', domain: 'api-production.up.railway.app' }],
    });

    const result = findByResourceId(recorded.passes, 'sd1');
    expect(result?.evidence).toMatchObject({
      verification: 'provider-attested',
      attestation: { attestedBy: 'Railway', independentlyVerified: false },
    });
  });

  it('reports truncated coverage instead of staying quiet', async () => {
    const env = makeEnvironment({ id: 'env-prod' }, [makeInstance({ serviceId: 'api' })], true);
    const recorded = makeRailwayContext({
      tokenWorkspaces: [WORKSPACE],
      projectPages: { [WORKSPACE.id]: [{ projects: [makeProject({ id: 'p1' }, [env])] }] },
    });
    await tlsDomainsCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.fails, 'ws-1:coverage')?.severity).toBe('low');
  });

  it('selects domain fields only, not deployments', async () => {
    const recorded = await runWith({});
    const projectsQuery = recorded.queries.find((q) => q.includes('RailwayWorkspaceProjects'));
    expect(projectsQuery).toContain('customDomains');
    expect(projectsQuery).not.toContain('activeDeployments');
  });

  it('pages through every project', async () => {
    const project = (id: string) =>
      makeProject({ id }, [
        makeEnvironment({ id: `env-${id}` }, [
          makeInstance({
            serviceId: id,
            domains: {
              customDomains: [makeCustomDomain({ id: `cd-${id}`, domain: `${id}.acme.com` })],
              serviceDomains: [],
            },
          }),
        ]),
      ]);
    const recorded = makeRailwayContext({
      tokenWorkspaces: [WORKSPACE],
      projectPages: {
        [WORKSPACE.id]: [
          { projects: [project('a')], hasNextPage: true },
          { projects: [project('b')] },
        ],
      },
    });
    await tlsDomainsCheck.run(recorded.ctx);

    expect(recorded.passes.map((pass) => pass.resourceId).sort()).toEqual(['cd-a', 'cd-b']);
  });
});

describe('parseWarningDays', () => {
  it('falls back to the default on junk and accepts numeric strings', () => {
    expect(parseWarningDays(undefined)).toBe(14);
    expect(parseWarningDays('abc')).toBe(14);
    expect(parseWarningDays(-1)).toBe(14);
    expect(parseWarningDays('30')).toBe(30);
  });
});
