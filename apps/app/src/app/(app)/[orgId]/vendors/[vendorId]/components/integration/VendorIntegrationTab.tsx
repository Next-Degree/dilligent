'use client';

import { useVendorIntegration } from '@/hooks/use-vendor-integration';
import { formatDate } from '@/lib/format';
import {
  Badge,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  Stack,
  Text,
} from '@trycompai/design-system';
import { Plug } from '@trycompai/design-system/icons';
import Link from 'next/link';
import { VendorIntegrationChecks } from './VendorIntegrationChecks';
import { VendorIntegrationUsers } from './VendorIntegrationUsers';

interface VendorIntegrationTabProps {
  vendorId: string;
  orgId: string;
}

/**
 * The vendor's linked integration: its checks and the people those checks
 * report as having access.
 *
 * The link is derived server-side from the vendor's name and website, so this
 * panel exists only for vendors that Comp AI can actually monitor. An
 * integration that matches but isn't connected gets a connect prompt instead of
 * an empty table.
 */
export function VendorIntegrationTab({ vendorId, orgId }: VendorIntegrationTabProps) {
  const { integration, checks, users, isLoading, error } =
    useVendorIntegration(vendorId);

  if (isLoading && !integration) {
    return (
      <Stack gap="md">
        <Skeleton style={{ height: '4rem' }} />
        <Skeleton style={{ height: '12rem' }} />
      </Stack>
    );
  }

  if (error || !integration) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Plug size={24} />
          </EmptyMedia>
          <EmptyTitle>No matching integration</EmptyTitle>
          <EmptyDescription>
            No integration in the catalog matches this vendor, so there are no
            automated checks or access lists to show.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" render={<Link href={`/${orgId}/integrations`} />}>
            Browse integrations
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const integrationHref = `/${orgId}/integrations/${integration.slug}`;

  return (
    <Stack gap="lg">
      <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {integration.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- provider logos are remote and unoptimized elsewhere too
            <img src={integration.logoUrl} alt="" className="h-9 w-9 rounded-lg" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium" title={integration.name}>
                {integration.name}
              </span>
              {integration.connected ? (
                <Badge variant="default">Connected</Badge>
              ) : (
                <Badge variant="outline">Not connected</Badge>
              )}
            </div>
            <Text size="xs" variant="muted">
              {integration.connected && integration.lastSyncAt
                ? `Last synced ${formatDate(integration.lastSyncAt)}`
                : `${integration.category} integration`}
            </Text>
          </div>
        </div>
        <div className="shrink-0">
          <Button variant="outline" size="sm" render={<Link href={integrationHref} />}>
            {integration.connected ? 'Manage integration' : 'Connect'}
          </Button>
        </div>
      </div>

      {!integration.connected ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Plug size={24} />
            </EmptyMedia>
            <EmptyTitle>Connect {integration.name}</EmptyTitle>
            <EmptyDescription>
              This vendor matches the {integration.name} integration. Connect it to
              see its compliance checks and who in your organization has access.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href={integrationHref} />}>
              Connect {integration.name}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <VendorIntegrationChecks
            integrationName={integration.name}
            checks={checks}
          />
          <VendorIntegrationUsers
            integrationName={integration.name}
            users={users}
          />
        </>
      )}
    </Stack>
  );
}
