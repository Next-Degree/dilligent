import type { IntegrationSourceInfo } from '../../integration-platform/services/check-results.service';
import type { VendorIntegrationMatchReason } from './vendor-integration-match';
import type { VendorIntegrationUser } from './vendor-integration-user';

/** The integration a vendor resolves to, plus this org's connection state. */
export interface VendorIntegrationLink extends IntegrationSourceInfo {
  /** How the vendor was identified as this integration (name, slug, …). */
  matchedOn: VendorIntegrationMatchReason;
}

/** A link carrying the vendor it belongs to, for org-wide listings. */
export interface VendorIntegrationLinkForVendor extends VendorIntegrationLink {
  vendorId: string;
}

/** The latest real run of one check. */
export interface VendorIntegrationCheckRun {
  runId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  totalChecked: number;
  passedCount: number;
  failedCount: number;
  errorMessage: string | null;
}

/** One check the linked integration runs, with its latest real outcome. */
export interface VendorIntegrationCheck {
  checkId: string;
  name: string;
  description: string;
  /** Task template this check can auto-complete, when it is bound to one. */
  taskMapping: string | null;
  lastRun: VendorIntegrationCheckRun | null;
}

export interface VendorIntegrationDetail {
  vendorId: string;
  /** Null when nothing in the catalog identifies this vendor. */
  integration: VendorIntegrationLink | null;
  /** Empty unless the matched integration is actually connected. */
  checks: VendorIntegrationCheck[];
  /** People the integration's access checks report, empty unless connected. */
  users: VendorIntegrationUser[];
}
