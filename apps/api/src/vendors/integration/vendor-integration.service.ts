import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { getActiveManifests } from '@trycompai/integration-platform';
import {
  CheckResultsService,
  type IntegrationSourceInfo,
} from '../../integration-platform/services/check-results.service';
import {
  loadIntegrationChecks,
  loadIntegrationUsers,
} from './vendor-integration-loaders';
import {
  findVendorIntegrationMatches,
  rankVendorIntegrationMatches,
  type MatchableManifest,
  type VendorIntegrationMatch,
} from './vendor-integration-match';
import type {
  VendorIntegrationDetail,
  VendorIntegrationLink,
  VendorIntegrationLinkForVendor,
} from './vendor-integration.types';

type MatchableVendor = { id: string; name: string; website: string | null };

/** Candidate integrations for a vendor, with which of them are connected. */
interface ResolvedSources {
  bySlug: Map<string, IntegrationSourceInfo>;
  connectedSlugs: Set<string>;
}

/**
 * Links a vendor to the integration for the same third party, and reads that
 * integration's checks and access lists for the vendor page.
 *
 * The link itself is derived, not stored: `vendor-integration-match` decides
 * which manifest identifies a vendor, and this service resolves the winner
 * against the org's live connections (a connected integration always beats an
 * unconnected one, since only it can supply checks and users). All check output
 * is read through `CheckResultsService` — the universal reuse point — and only
 * interpreted here, in the feature.
 */
@Injectable()
export class VendorIntegrationService {
  constructor(private readonly checkResults: CheckResultsService) {}

  /**
   * The integration each vendor in the org resolves to. Vendors that match
   * nothing are omitted, so the caller can key straight off `vendorId`.
   */
  async listLinks(
    organizationId: string,
  ): Promise<VendorIntegrationLinkForVendor[]> {
    const vendors = await db.vendor.findMany({
      where: { organizationId },
      select: { id: true, name: true, website: true },
    });
    if (vendors.length === 0) return [];

    const manifests = matchableManifests();
    const candidatesByVendor = new Map<string, VendorIntegrationMatch[]>();
    for (const vendor of vendors) {
      const matches = candidateMatches(vendor, manifests);
      if (matches.length > 0) candidatesByVendor.set(vendor.id, matches);
    }
    if (candidatesByVendor.size === 0) return [];

    const allSlugs = Array.from(candidatesByVendor.values()).flatMap(
      (matches) => matches.map((match) => match.slug),
    );
    const sources = await this.loadSources(
      organizationId,
      Array.from(new Set(allSlugs)),
    );

    const links: VendorIntegrationLinkForVendor[] = [];
    for (const [vendorId, matches] of candidatesByVendor) {
      const link = resolveLink(matches, sources);
      if (link) links.push({ ...link, vendorId });
    }
    return links;
  }

  /**
   * A vendor's linked integration with its checks and the people those checks
   * report. Checks and users are only loaded when the integration is connected
   * — an unconnected match has nothing to show but is still reported, so the UI
   * can offer to connect it.
   */
  async getForVendor(
    vendorId: string,
    organizationId: string,
  ): Promise<VendorIntegrationDetail> {
    const vendor = await db.vendor.findFirst({
      where: { id: vendorId, organizationId },
      select: { id: true, name: true, website: true },
    });
    if (!vendor) {
      throw new NotFoundException(`Vendor ${vendorId} not found`);
    }

    const candidates = candidateMatches(vendor, matchableManifests());
    if (candidates.length === 0) {
      return { vendorId, integration: null, checks: [], users: [] };
    }

    const sources = await this.loadSources(
      organizationId,
      candidates.map((match) => match.slug),
    );
    const integration = resolveLink(candidates, sources);

    if (!integration?.connected || !integration.connectionId) {
      return {
        vendorId,
        integration: integration ?? null,
        checks: [],
        users: [],
      };
    }

    const connected = {
      checkResults: this.checkResults,
      organizationId,
      connectionId: integration.connectionId,
      slug: integration.slug,
    };
    const [checks, users] = await Promise.all([
      loadIntegrationChecks(connected),
      loadIntegrationUsers(connected),
    ]);

    return { vendorId, integration, checks, users };
  }

  private async loadSources(
    organizationId: string,
    slugs: string[],
  ): Promise<ResolvedSources> {
    const sources = await this.checkResults.listSourcesBySlugs(
      organizationId,
      slugs,
    );
    return {
      bySlug: new Map(sources.map((source) => [source.slug, source])),
      connectedSlugs: new Set(
        sources
          .filter((source) => source.connected)
          .map((source) => source.slug),
      ),
    };
  }
}

/** Every integration that could be this vendor, before connections are known. */
function candidateMatches(
  vendor: MatchableVendor,
  manifests: MatchableManifest[],
): VendorIntegrationMatch[] {
  return findVendorIntegrationMatches({
    vendorName: vendor.name,
    vendorWebsite: vendor.website,
    manifests,
  });
}

/**
 * The winning integration for a vendor once connection state is known — the
 * matches are only re-ranked here, never recomputed.
 */
function resolveLink(
  matches: VendorIntegrationMatch[],
  sources: ResolvedSources,
): VendorIntegrationLink | null {
  const [best] = rankVendorIntegrationMatches(matches, sources.connectedSlugs);
  const source = best ? sources.bySlug.get(best.slug) : undefined;
  if (!best || !source) return null;

  return { ...source, matchedOn: best.matchedOn };
}

/** The catalog, reduced to the fields matching needs. */
function matchableManifests(): MatchableManifest[] {
  return getActiveManifests().map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    baseUrl: manifest.baseUrl,
  }));
}
