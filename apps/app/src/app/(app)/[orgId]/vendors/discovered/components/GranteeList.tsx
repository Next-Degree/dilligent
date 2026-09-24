'use client';

import type { DiscoveredVendorGrantee } from '@/hooks/use-discovered-vendors';
import { Stack, Text } from '@trycompai/design-system';

interface GranteeListProps {
  grantees: DiscoveredVendorGrantee[];
}

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/**
 * Who has authorized an application.
 *
 * The copy says "authorized", never "used" or "active recently": the provider reports only
 * that a grant exists, with no last-used timestamp, and implying recency would misrepresent
 * what was actually observed.
 */
export function GranteeList({ grantees }: GranteeListProps) {
  if (grantees.length === 0) {
    return (
      <Text variant="muted">
        Nobody currently holds access. Access that was withdrawn is kept in the person&apos;s
        own access history.
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      <Text variant="muted">
        {grantees.length === 1
          ? '1 person has authorized this application'
          : `${grantees.length} people have authorized this application`}
      </Text>

      <ul className="divide-y divide-border rounded-md border">
        {grantees.map((grantee) => (
          <li
            key={grantee.id}
            className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {grantee.member.user?.name || grantee.member.user?.email || 'Unknown person'}
              </p>
              {grantee.member.user?.name && grantee.member.user?.email && (
                <p className="truncate text-xs text-muted-foreground">
                  {grantee.member.user.email}
                </p>
              )}
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              Authorized {formatDate(grantee.firstSeenAt)}
              {grantee.scopes.length > 0 && (
                <span className="hidden sm:inline">
                  {' · '}
                  {grantee.scopes.length}{' '}
                  {grantee.scopes.length === 1 ? 'permission' : 'permissions'}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Stack>
  );
}
