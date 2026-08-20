'use client';

import { useVendorIntegrationLinks } from '@/hooks/use-vendor-integration';
import { Badge } from '@trycompai/design-system';

/**
 * Marks a vendor whose integration is connected, so the register shows at a
 * glance which third parties Comp AI monitors automatically.
 *
 * Every row shares one SWR request (the links are fetched org-wide and deduped
 * by key), so this stays a single call no matter how many vendors are listed.
 * Vendors with no match — or a match that isn't connected — render nothing.
 */
export function VendorIntegrationBadge({ vendorId }: { vendorId: string }) {
  const { linksByVendorId } = useVendorIntegrationLinks();
  const link = linksByVendorId.get(vendorId);

  if (!link?.connected) return null;

  return (
    <Badge variant="accent" title={`Monitored by ${link.name}`}>
      {link.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- remote provider logo, matches the integrations pages
        <img src={link.logoUrl} alt="" className="h-3 w-3 rounded-sm" />
      )}
      {link.name}
    </Badge>
  );
}
