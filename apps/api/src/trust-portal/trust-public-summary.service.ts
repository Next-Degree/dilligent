import { Injectable, NotFoundException } from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@db';
import { APP_AWS_ORG_ASSETS_BUCKET, getSignedUrl, s3Client } from '../app/s3';
import type {
  TrustPublicCertificationDto,
  TrustPublicSummaryDto,
} from './dto/trust-public-summary.dto';

type CertificationStatus = TrustPublicCertificationDto['status'];

type CertificationRow = {
  framework: string;
  enabled: boolean;
  status: CertificationStatus;
};

const SIGNED_URL_TTL_SECONDS = 3600;

@Injectable()
export class TrustPublicSummaryService {
  /**
   * Maps a custom domain to the friendlyUrl of the published portal that owns
   * it, so the trust site can serve any org's portal from one deployment.
   * Only verified domains of published portals resolve.
   */
  async resolveDomain(domain: string): Promise<{ friendlyUrl: string }> {
    const trust = await db.trust.findFirst({
      where: {
        domain: domain.trim().toLowerCase(),
        domainVerified: true,
        status: 'published',
        friendlyUrl: { not: null },
      },
      select: { friendlyUrl: true },
    });

    if (!trust?.friendlyUrl) {
      throw new NotFoundException('Trust site not found');
    }

    return { friendlyUrl: trust.friendlyUrl };
  }

  /**
   * Everything the public trust page header, stat tiles, framework badges,
   * policies and controls sections need, in a single round trip.
   */
  async getSummary(routeId: string): Promise<TrustPublicSummaryDto> {
    const trust = await this.findPublishedTrust(routeId);
    const { organization, organizationId } = trust;

    const [policies, controls, frameworks, subprocessors] = await Promise.all([
      db.policy.findMany({
        where: {
          organizationId,
          status: 'published',
          isArchived: false,
          archivedAt: null,
        },
        select: { id: true, name: true, description: true },
        orderBy: { name: 'asc' },
      }),
      db.control.findMany({
        where: { organizationId, archivedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      db.frameworkInstance.count({ where: { organizationId } }),
      db.vendor.count({
        where: { organizationId, showOnTrustPortal: true },
      }),
    ]);

    const certifications = this.toCertifications(trust);

    return {
      friendlyUrl: trust.friendlyUrl ?? organizationId,
      organizationName: organization.name,
      logoUrl: await this.signKey(organization.logo),
      faviconUrl: await this.signKey(trust.favicon),
      primaryColor: organization.primaryColor,
      website: organization.website,
      certifications,
      stats: {
        policies: policies.length,
        controls: controls.length,
        frameworks: Math.max(frameworks, certifications.length),
        subprocessors,
      },
      policies,
      controls,
    };
  }

  private async findPublishedTrust(routeId: string) {
    const include = { organization: true } as const;
    const where = { status: 'published' as const };

    const trust =
      (await db.trust.findFirst({
        where: { ...where, friendlyUrl: routeId },
        include,
      })) ??
      (await db.trust.findFirst({
        where: { ...where, organizationId: routeId },
        include,
      }));

    if (!trust) {
      throw new NotFoundException('Trust site not found');
    }

    return trust;
  }

  private toCertifications(
    trust: Awaited<ReturnType<TrustPublicSummaryService['findPublishedTrust']>>,
  ): TrustPublicCertificationDto[] {
    const rows: CertificationRow[] = [
      {
        framework: 'soc2_type2',
        enabled: trust.soc2type2,
        status: trust.soc2type2_status,
      },
      {
        framework: 'soc2_type1',
        enabled: trust.soc2type1,
        status: trust.soc2type1_status,
      },
      { framework: 'soc2', enabled: trust.soc2, status: trust.soc2_status },
      { framework: 'soc3', enabled: trust.soc3, status: trust.soc3_status },
      {
        framework: 'iso_27001',
        enabled: trust.iso27001,
        status: trust.iso27001_status,
      },
      {
        framework: 'iso_42001',
        enabled: trust.iso42001,
        status: trust.iso42001_status,
      },
      {
        framework: 'iso_9001',
        enabled: trust.iso9001,
        status: trust.iso9001_status,
      },
      {
        framework: 'nen_7510',
        enabled: trust.nen7510,
        status: trust.nen7510_status,
      },
      { framework: 'gdpr', enabled: trust.gdpr, status: trust.gdpr_status },
      { framework: 'hipaa', enabled: trust.hipaa, status: trust.hipaa_status },
      {
        framework: 'pci_dss',
        enabled: trust.pci_dss,
        status: trust.pci_dss_status,
      },
      {
        framework: 'pipeda',
        enabled: trust.pipeda,
        status: trust.pipeda_status,
      },
      { framework: 'ccpa', enabled: trust.ccpa, status: trust.ccpa_status },
    ];

    return rows
      .filter((row) => row.enabled)
      .map(({ framework, status }) => ({ framework, status }));
  }

  private async signKey(key: string | null): Promise<string | null> {
    if (!key || !s3Client || !APP_AWS_ORG_ASSETS_BUCKET) return null;

    try {
      return await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: APP_AWS_ORG_ASSETS_BUCKET, Key: key }),
        { expiresIn: SIGNED_URL_TTL_SECONDS },
      );
    } catch {
      return null;
    }
  }
}
