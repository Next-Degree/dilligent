'use client';

import { Badge } from '@trycompai/design-system';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface VendorsTabsProps {
  orgId: string;
  /** Applications awaiting review. Omitted or zero hides the badge entirely. */
  pendingCount?: number;
}

/**
 * Navigation between the vendor register and the discovery review queue.
 *
 * The register stays the default route: discovery is an inbox that is empty most days, and
 * making it the landing page would put an empty screen in front of the thing people came for.
 */
export function VendorsTabs({ orgId, pendingCount = 0 }: VendorsTabsProps) {
  const pathname = usePathname();
  const isDiscovered = pathname?.endsWith('/vendors/discovered');

  const tabs = [
    { href: `/${orgId}/vendors`, label: 'All vendors', active: !isDiscovered },
    {
      href: `/${orgId}/vendors/discovered`,
      label: 'Discovered',
      active: Boolean(isDiscovered),
      count: pendingCount,
    },
  ];

  return (
    <nav aria-label="Vendors" className="mb-4 border-b">
      <ul className="-mb-px flex gap-4 overflow-x-auto">
        {tabs.map((tab) => (
          <li key={tab.href} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={`flex min-h-10 items-center gap-2 border-b-2 px-1 py-2 text-sm transition-colors ${
                tab.active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.count ? (
                <span>
                  <Badge variant="secondary">{tab.count}</Badge>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
