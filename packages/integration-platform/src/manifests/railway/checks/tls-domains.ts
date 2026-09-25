import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, CheckVariable, IntegrationCheck } from '../../../types';
import { edgeTlsAttestation } from '../attestation';
import {
  instanceEvidence,
  loadInstances,
  resolveRailwayScope,
  type ScopedInstance,
} from '../scope';
import type { RailwayCertificate, RailwayCustomDomain } from '../types';

/**
 * Railway renews certificates when 30 days of validity remain, so a
 * certificate inside 14 days of expiry means renewal has been failing for
 * over two weeks.
 */
export const DEFAULT_EXPIRY_WARNING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const VALID = 'CERTIFICATE_STATUS_TYPE_VALID';
const PENDING = new Set([
  'CERTIFICATE_STATUS_TYPE_ISSUING',
  'CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP',
]);

export const expiryWarningDaysVariable: CheckVariable = {
  id: 'expiry_warning_days',
  label: 'Certificate expiry warning (days)',
  type: 'number',
  required: false,
  default: DEFAULT_EXPIRY_WARNING_DAYS,
  helpText:
    'Fail a custom domain whose certificate expires within this many days. Railway renews at 30 days remaining.',
};

export function parseWarningDays(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : DEFAULT_EXPIRY_WARNING_DAYS;
}

/** The latest expiry among the certificates Railway reports, or null when none carries one. */
export function latestExpiry(certificates: RailwayCertificate[] | null | undefined): Date | null {
  const times = (certificates ?? [])
    .map((cert) => (cert.expiresAt ? Date.parse(cert.expiresAt) : Number.NaN))
    .filter((time) => Number.isFinite(time));
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

function judgeCustomDomain(
  ctx: CheckContext,
  {
    scoped,
    domain,
    warningDays,
    checkedAt,
  }: {
    scoped: ScopedInstance;
    domain: RailwayCustomDomain;
    warningDays: number;
    checkedAt: string;
  },
): void {
  const { status } = domain;
  const expiresAt = latestExpiry(status.certificates);
  const daysLeft = expiresAt
    ? Math.floor((expiresAt.getTime() - Date.parse(checkedAt)) / DAY_MS)
    : null;
  const behindCdn = Boolean(
    status.cdnProvider && status.cdnProvider !== 'DETECTED_CDN_PROVIDER_UNSPECIFIED',
  );
  const base = {
    resourceType: 'railway_custom_domain',
    resourceId: domain.id,
  };
  const evidence = {
    verification: 'api-verified',
    ...instanceEvidence(scoped),
    domain: domain.domain,
    certificateStatus: status.certificateStatus,
    certificateError: status.certificateErrorMessage ?? null,
    cdnProvider: status.cdnProvider ?? null,
    dnsVerified: status.verified,
    certificateExpiresAt: expiresAt?.toISOString() ?? null,
    daysUntilExpiry: daysLeft,
    keyTypes: (status.certificates ?? []).map((cert) => cert.keyType),
    checkedAt,
  };

  if (status.certificateStatus === VALID && daysLeft !== null && daysLeft > warningDays) {
    ctx.pass({
      ...base,
      title: `Valid TLS certificate: ${domain.domain}`,
      description: `${domain.domain} serves a valid certificate that expires in ${daysLeft} day(s).`,
      evidence,
    });
    return;
  }

  if (status.certificateStatus === VALID) {
    ctx.fail({
      ...base,
      title:
        daysLeft === null
          ? `Certificate expiry unknown: ${domain.domain}`
          : `Certificate expiring: ${domain.domain}`,
      description:
        daysLeft === null
          ? `Railway reports a valid certificate for ${domain.domain} but no expiry date, so its validity cannot be evidenced.`
          : `The certificate for ${domain.domain} expires in ${daysLeft} day(s). Railway renews at 30 days remaining, so renewal is failing.`,
      severity: daysLeft !== null && daysLeft < 0 ? 'high' : 'medium',
      remediation:
        'Open the service Settings > Networking in Railway, confirm the DNS record still points at Railway, and retry certificate issuance.',
      evidence,
    });
    return;
  }

  // A proxied domain (Cloudflare orange cloud) may never get a Railway
  // certificate; TLS terminates at the CDN instead, which the API cannot see.
  if (behindCdn) {
    ctx.fail({
      ...base,
      title: `TLS terminated at CDN, unverified: ${domain.domain}`,
      description: `${domain.domain} is proxied through ${status.cdnProvider} and has no valid Railway certificate. The CDN-to-Railway hop is encrypted with Railway's default certificate, but the client-facing TLS settings live in the CDN and could not be read.`,
      severity: 'medium',
      remediation:
        'In Cloudflare, set SSL/TLS mode to Full (strict) and enable Always Use HTTPS for this hostname, then record that as evidence.',
      evidence,
    });
    return;
  }

  const pending = PENDING.has(status.certificateStatus);
  ctx.fail({
    ...base,
    title: pending
      ? `Certificate not yet issued: ${domain.domain}`
      : `No valid certificate: ${domain.domain}`,
    description: pending
      ? `Railway is still issuing a certificate for ${domain.domain} (${status.certificateStatus}), so HTTPS clients cannot connect to it yet.`
      : `${domain.domain} has no valid certificate (${status.certificateStatus}${status.certificateErrorMessage ? `: ${status.certificateErrorMessage}` : ''}).`,
    severity: pending ? 'medium' : 'high',
    remediation:
      "Point the domain's DNS at the record Railway shows under the service Settings > Networking, then retry issuance. Remove the domain if it is no longer used.",
    evidence,
  });
}

/**
 * Railway TLS on Public Domains
 *
 * Reads every public domain on every service. Custom domains are judged on the
 * certificate Railway actually reports: status, expiry, and whether TLS is
 * terminated elsewhere. Railway-generated domains share Railway's managed
 * certificate, so they rest on Railway's published edge-TLS claim and are
 * recorded as attested, never as verified.
 *
 * Out of scope: TCP proxies. They forward raw TCP, so whether that traffic is
 * encrypted depends on the service behind them, not on anything Railway reports.
 *
 * Maps to: TLS / HTTPS
 */
export const tlsDomainsCheck: IntegrationCheck = {
  id: 'railway-tls-domains',
  name: 'TLS on Public Domains',
  description:
    'Verify every Railway public domain serves a valid, non-expiring TLS certificate over HTTPS',
  service: 'security',
  taskMapping: TASK_TEMPLATES.tlsHttps,
  defaultSeverity: 'high',
  variables: [expiryWarningDaysVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Railway TLS check');

    const scope = await resolveRailwayScope(ctx);
    if (!scope) return;
    const { checkedAt } = scope;
    const warningDays = parseWarningDays(ctx.variables?.expiry_warning_days);
    let domainCount = 0;

    for (const workspace of scope.workspaces) {
      const loaded = await loadInstances(ctx, { workspace, checkedAt });
      if (!loaded) continue;

      for (const scoped of loaded.instances) {
        const { customDomains, serviceDomains } = scoped.instance.domains;
        for (const domain of customDomains) {
          domainCount++;
          judgeCustomDomain(ctx, { scoped, domain, warningDays, checkedAt });
        }
        for (const domain of serviceDomains) {
          domainCount++;
          ctx.pass({
            title: `HTTPS enforced by Railway edge: ${domain.domain}`,
            description: `${domain.domain} is a Railway-generated domain served with Railway's managed certificate. Railway attests that its edge only accepts TLS 1.2+ and redirects plain HTTP to HTTPS; this is Railway's published claim and has not been independently verified.`,
            resourceType: 'railway_service_domain',
            resourceId: domain.id,
            evidence: {
              verification: 'provider-attested',
              ...edgeTlsAttestation(),
              ...instanceEvidence(scoped),
              domain: domain.domain,
              checkedAt,
            },
          });
        }
      }
    }

    ctx.log(`Railway TLS check complete: ${domainCount} public domain(s) reviewed`);
  },
};
