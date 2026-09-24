import { Injectable, Logger } from '@nestjs/common';
import { db, VendorResolutionMethod } from '@db';
import { extractDomain } from '../vendor-website';
import { isUnusableVendorName, normalizeVendorName } from './normalize-vendor-name';
import { registrableDomain } from './registrable-domain';

/**
 * Google's own first-party OAuth clients. These are not third-party vendors — leaving them in
 * makes a large share of the review queue noise, which is how a queue stops being read.
 * They are ignored with a recorded reason rather than dropped, so they stay auditable and
 * can be reopened.
 */
const FIRST_PARTY_NAME_PATTERNS = [
  /^google\b/i,
  /^android\b/i,
  /^chrome\b/i,
  /^youtube\b/i,
  /^gmail\b/i,
  /\bgoogle (drive|docs|sheets|slides|calendar|photos|play|cloud|apps script)\b/i,
];

/** Inference is a suggestion, never a decision — its confidence is capped here. */
export const INFERENCE_CONFIDENCE_CEILING = 0.7;

/** Integration definitions change rarely; re-reading 500+ rows per candidate would not. */
const INTEGRATION_CACHE_TTL_MS = 60 * 60 * 1000;

export interface ResolutionCandidate {
  externalAppId: string;
  displayName: string | null;
  nativeApp: boolean;
  anonymous: boolean;
}

export interface ResolutionOutcome {
  method: VendorResolutionMethod;
  /** Set only for `existing_vendor`, where the app is already in the register. */
  vendorId: string | null;
  resolvedName: string | null;
  resolvedWebsite: string | null;
  resolvedDescription: string | null;
  confidence: number | null;
  /** When set, the candidate is created already ignored, with this reason. */
  autoIgnoreReason: string | null;
  /** Whether this candidate should be offered to the inference fallback. */
  eligibleForInference: boolean;
}

interface IntegrationEntry {
  name: string;
  description: string;
  domain: string | null;
}

@Injectable()
export class VendorResolutionService {
  private readonly logger = new Logger(VendorResolutionService.name);

  private integrationCache: { entries: Map<string, IntegrationEntry>; loadedAt: number } | null =
    null;

  /**
   * Resolve a discovered application to a known vendor, deterministically where possible.
   *
   * Every tier matches on **exact** equality after normalization. Fuzzy or partial similarity
   * is deliberately absent: a wrong link attributes one company's access to another inside an
   * auditable register, which is worse than leaving the candidate unresolved for a human.
   */
  async resolve({
    candidate,
    organizationId,
  }: {
    candidate: ResolutionCandidate;
    organizationId: string;
  }): Promise<ResolutionOutcome> {
    const unresolved: ResolutionOutcome = {
      method: VendorResolutionMethod.unresolved,
      vendorId: null,
      resolvedName: null,
      resolvedWebsite: null,
      resolvedDescription: null,
      confidence: null,
      autoIgnoreReason: null,
      eligibleForInference: false,
    };

    // An app with no usable identity has nothing to resolve, and nothing to ask an AI about.
    if (candidate.anonymous || isUnusableVendorName(candidate.displayName)) {
      return unresolved;
    }

    const displayName = candidate.displayName as string;

    if (this.isFirstParty({ displayName })) {
      return {
        ...unresolved,
        autoIgnoreReason: 'First-party Google application, not a third-party vendor',
      };
    }

    const normalized = normalizeVendorName(displayName);

    const existing = await this.matchExistingVendor({ normalized, organizationId });
    if (existing) return existing;

    const catalogued = await this.matchGlobalCatalogue(normalized);
    if (catalogued) return catalogued;

    const integration = await this.matchIntegrationDefinition(normalized);
    if (integration) return integration;

    // Survived every deterministic tier — a real name we simply do not recognise.
    return { ...unresolved, eligibleForInference: true };
  }

  /**
   * Matches on the name only. Google's `nativeApp` flag is deliberately not used as
   * evidence: plenty of genuine third-party desktop clients set it, so treating it as
   * first-party would auto-ignore real vendors out of the review queue.
   */
  private isFirstParty({ displayName }: { displayName: string }): boolean {
    return FIRST_PARTY_NAME_PATTERNS.some((pattern) => pattern.test(displayName.trim()));
  }

  /**
   * Tier 1 — the organization's own register. This is the anti-duplicate guarantee: an app
   * already tracked as a vendor must never be offered for creation a second time.
   */
  private async matchExistingVendor({
    normalized,
    organizationId,
  }: {
    normalized: string;
    organizationId: string;
  }): Promise<ResolutionOutcome | null> {
    if (!normalized) return null;

    const vendors = await db.vendor.findMany({
      where: { organizationId },
      select: { id: true, name: true, website: true, description: true },
    });

    const match = vendors.find((vendor) => normalizeVendorName(vendor.name) === normalized);
    if (!match) return null;

    return {
      method: VendorResolutionMethod.existing_vendor,
      vendorId: match.id,
      resolvedName: match.name,
      resolvedWebsite: match.website,
      resolvedDescription: match.description,
      confidence: 1,
      autoIgnoreReason: null,
      eligibleForInference: false,
    };
  }

  /** Tier 2 — the shared catalogue, which yields a canonical website and description. */
  private async matchGlobalCatalogue(normalized: string): Promise<ResolutionOutcome | null> {
    if (!normalized) return null;

    // `contains` is a prefilter for the exact comparison below, not the match itself.
    const rows = await db.globalVendors.findMany({
      where: {
        OR: [
          { company_name: { contains: normalized, mode: 'insensitive' } },
          { legal_name: { contains: normalized, mode: 'insensitive' } },
        ],
      },
      take: 50,
      select: { website: true, company_name: true, legal_name: true, company_description: true },
    });

    const match = rows.find(
      (row) =>
        normalizeVendorName(row.company_name) === normalized ||
        normalizeVendorName(row.legal_name) === normalized,
    );
    if (!match) return null;

    return {
      method: VendorResolutionMethod.global_catalogue,
      vendorId: null,
      resolvedName: match.company_name ?? match.legal_name,
      resolvedWebsite: match.website,
      resolvedDescription: match.company_description,
      confidence: 1,
      autoIgnoreReason: null,
      eligibleForInference: false,
    };
  }

  /** Tier 3 — active integration definitions, giving a name to domain mapping. */
  private async matchIntegrationDefinition(
    normalized: string,
  ): Promise<ResolutionOutcome | null> {
    if (!normalized) return null;

    const entries = await this.loadIntegrations();
    const match = entries.get(normalized);
    if (!match) return null;

    return {
      method: VendorResolutionMethod.integration_definition,
      vendorId: null,
      resolvedName: match.name,
      resolvedWebsite: match.domain ? `https://${match.domain}` : null,
      resolvedDescription: match.description,
      confidence: 1,
      autoIgnoreReason: null,
      eligibleForInference: false,
    };
  }

  private async loadIntegrations(): Promise<Map<string, IntegrationEntry>> {
    const now = Date.now();
    if (this.integrationCache && now - this.integrationCache.loadedAt < INTEGRATION_CACHE_TTL_MS) {
      return this.integrationCache.entries;
    }

    const entries = new Map<string, IntegrationEntry>();
    try {
      const integrations = await db.dynamicIntegration.findMany({
        where: { isActive: true },
        select: { name: true, description: true, baseUrl: true },
      });

      for (const integration of integrations) {
        const key = normalizeVendorName(integration.name);
        if (!key || entries.has(key)) continue;
        entries.set(key, {
          name: integration.name,
          description: integration.description,
          domain: registrableDomain(extractDomain(integration.baseUrl)),
        });
      }
    } catch (error) {
      this.logger.warn(`Could not load integration definitions for resolution: ${String(error)}`);
      // Fall through with whatever was loaded; a miss only costs a resolution tier.
    }

    this.integrationCache = { entries, loadedAt: now };
    return entries;
  }
}
