import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import { API_VERIFIED, NEON_ATTESTATION, attestationEvidence } from '../attestation';
import { listNeonEndpoints } from '../client';
import { limitProjects, projectEvidence, resolveNeonScope } from '../scope';
import type { NeonEndpoint, NeonProject } from '../types';
import { projectScopeVariables } from '../variables';

const NEON_PROXY_SUFFIX = '.neon.tech';

/**
 * Whether a compute endpoint is served through a Neon proxy, which is what
 * terminates TLS and rejects connections that do not negotiate it. An
 * enterprise deployment can serve a different domain, so the project's own
 * `proxy_host` counts too.
 */
export function isNeonProxyHost(host: string | undefined, proxyHost: string | undefined): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  if (normalized.endsWith(NEON_PROXY_SUFFIX)) return true;
  const proxy = proxyHost?.trim().toLowerCase();
  return Boolean(proxy && (normalized === proxy || normalized.endsWith(`.${proxy}`)));
}

const describeEndpoint = (endpoint: NeonEndpoint) => ({
  endpointId: endpoint.id,
  host: endpoint.host ?? null,
  type: endpoint.type ?? null,
  branchId: endpoint.branch_id ?? null,
  disabled: endpoint.disabled ?? false,
  passwordlessAccess: endpoint.passwordless_access ?? null,
  currentState: endpoint.current_state ?? null,
});

const connectionPosture = (project: NeonProject) => ({
  blockPublicConnections: project.settings?.block_public_connections ?? null,
  blockVpcConnections: project.settings?.block_vpc_connections ?? null,
  allowedIpCount: project.settings?.allowed_ips?.ips?.length ?? null,
  allowedIpsProtectedBranchesOnly: project.settings?.allowed_ips?.protected_branches_only ?? null,
});

/**
 * Neon SSL Database Connection Enabled
 *
 * Neon requires TLS on every Postgres connection and supports `verify-full`;
 * there is no per-project switch to read, so the platform guarantee is
 * attested. What the API can prove per project — and what this check reads —
 * is that every live compute endpoint is served through a Neon proxy, the
 * component that enforces that TLS. An endpoint on an unrecognised host is
 * reported as unconfirmed rather than assumed encrypted.
 *
 * Maps to: TLS / HTTPS
 */
export const sslConnectionsCheck: IntegrationCheck = {
  id: 'ssl-connections-enabled',
  name: 'SSL Database Connection Enabled',
  description: 'Verify Neon database endpoints are served over TLS-enforcing Neon proxies',
  service: 'security',
  taskMapping: TASK_TEMPLATES.tlsHttps,
  defaultSeverity: 'high',
  variables: projectScopeVariables,

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Neon SSL connection check');

    const scope = await resolveNeonScope(ctx);
    if (!scope) return;

    const projects = limitProjects(ctx, scope);
    const attestation = attestationEvidence(NEON_ATTESTATION.transportSecurity);
    let tlsConfirmedCount = 0;

    for (const project of projects) {
      const name = project.name ?? project.id;

      let endpoints: NeonEndpoint[];
      try {
        endpoints = await listNeonEndpoints(ctx, project.id);
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Connection encryption unconfirmed: ${name}`,
          description: `Could not read the project's compute endpoints: ${failure.error}`,
          resourceType: 'neon_project',
          resourceId: project.id,
          severity: 'medium',
          remediation: remediationForReadFailure(
            failure,
            'Confirm the Neon API key still has access to this project, then re-run the check.',
          ),
          evidence: {
            ...projectEvidence(project),
            error: failure.error,
            denied: failure.denied,
            checkedAt: scope.checkedAt,
          },
        });
        continue;
      }

      const live = endpoints.filter((endpoint) => endpoint.disabled !== true);
      const unconfirmed = live.filter(
        (endpoint) => !isNeonProxyHost(endpoint.host, project.proxy_host ?? undefined),
      );

      const evidence = {
        ...attestation,
        ...projectEvidence(project),
        endpointVerification: API_VERIFIED,
        proxyHost: project.proxy_host ?? null,
        endpointCount: endpoints.length,
        liveEndpointCount: live.length,
        endpoints: endpoints.map(describeEndpoint),
        ...connectionPosture(project),
        checkedAt: scope.checkedAt,
      };

      if (unconfirmed.length > 0) {
        ctx.fail({
          title: `Connection encryption unconfirmed: ${name}`,
          description: `${unconfirmed.length} of ${live.length} live endpoint(s) on "${name}" are not served from a recognised Neon proxy host, so TLS enforcement could not be confirmed for them.`,
          resourceType: 'neon_project',
          resourceId: project.id,
          severity: 'high',
          remediation:
            'Confirm these endpoints are reached through their Neon-issued hostname, and that clients connect with `sslmode=verify-full` rather than a proxy or tunnel that terminates TLS elsewhere.',
          evidence: { ...evidence, unconfirmedEndpointIds: unconfirmed.map((e) => e.id) },
        });
        continue;
      }

      tlsConfirmedCount++;
      ctx.pass({
        title: `SSL connections enforced: ${name}`,
        description:
          live.length > 0
            ? `All ${live.length} live compute endpoint(s) are served through Neon proxies, which require SSL/TLS and support verify-full.`
            : 'This project has no live compute endpoints; Neon requires SSL/TLS on any endpoint it later serves.',
        resourceType: 'neon_project',
        resourceId: project.id,
        evidence,
      });
    }

    ctx.log(
      `Neon SSL connection check complete: ${tlsConfirmedCount}/${projects.length} project(s) confirmed`,
    );
  },
};
