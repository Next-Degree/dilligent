'use client';

import { apiClient } from '@/lib/api-client';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Stack,
  Text,
} from '@trycompai/design-system';
import useSWR from 'swr';
import { AccessSourceNote } from './AccessSourceNote';

interface VendorAccessGrant {
  id: string;
  scopes: string[];
  source: string;
  externalAppId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  reappearedAt: string | null;
  vendor: { id: string; name: string; website: string | null } | null;
  candidate: {
    id: string;
    displayName: string | null;
    status: string;
    resolvedName: string | null;
  } | null;
}

interface VendorAccessResponse {
  data: VendorAccessGrant[];
  count: number;
}

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const applicationName = (grant: VendorAccessGrant): string =>
  grant.vendor?.name ??
  grant.candidate?.resolvedName ??
  grant.candidate?.displayName ??
  grant.externalAppId;

/**
 * Third-party applications this person has authorized with their work account.
 *
 * Kept separate from the per-integration access sections above it: those report what a
 * connected system says about the person's account there, while this reports what the
 * person granted to third parties — a different question with different consequences at
 * offboarding.
 */
export function EmployeeVendorAccess({ memberId }: { memberId: string }) {
  const { data, isLoading } = useSWR<VendorAccessGrant[]>(
    memberId ? ['member-vendor-access', memberId] : null,
    async () => {
      const response = await apiClient.get<VendorAccessResponse>(
        `/v1/people/${memberId}/vendor-access`,
      );
      if (response.error) throw new Error(response.error);
      return response.data?.data ?? [];
    },
    { revalidateOnFocus: false },
  );

  const grants = Array.isArray(data) ? data : [];
  const active = grants.filter((grant) => grant.revokedAt === null);
  const withdrawn = grants.filter((grant) => grant.revokedAt !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Third-party app access</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack gap="md">
          <AccessSourceNote>
            From this person&apos;s Google Workspace sign-ins. Counts here can differ from
            Access in connected tools — someone may have an account in a tool without ever
            signing into it with Google, and vice versa.
          </AccessSourceNote>
          {isLoading ? (
            <Stack gap="sm">
              {/* Skeleton takes no className — size it from a wrapper. */}
              <div className="h-5 w-2/3">
                <Skeleton />
              </div>
              <div className="h-5 w-1/2">
                <Skeleton />
              </div>
            </Stack>
          ) : grants.length === 0 ? (
            <Text variant="muted">
              No third-party applications have been observed for this person. Only apps signed
              into with a work Google account are visible here.
            </Text>
          ) : (
            <Stack gap="md">
              {/* "Authorized", never "used" — the provider reports no last-used signal. */}
              <Text variant="muted">
                Applications this person has authorized. This does not indicate recent use.
              </Text>

              <ul className="divide-y divide-border rounded-md border">
                {[...active, ...withdrawn].map((grant) => (
                  <li
                    key={grant.id}
                    className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {applicationName(grant)}
                      </span>
                      {grant.revokedAt && (
                        <span>
                          <Badge variant="outline">
                            {grant.revokedReason === 'offboarding' ? 'Revoked' : 'No longer seen'}
                          </Badge>
                        </span>
                      )}
                      {grant.reappearedAt && (
                        // Access revoked at offboarding that came back is a finding.
                        <span>
                          <Badge variant="destructive">Reappeared</Badge>
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                      Authorized {formatDate(grant.firstSeenAt)}
                      {grant.scopes.length > 0 && (
                        <span className="hidden sm:inline">
                          {' · '}
                          {grant.scopes.length}{' '}
                          {grant.scopes.length === 1 ? 'permission' : 'permissions'}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
