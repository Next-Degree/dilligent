'use client';

import { usePermissions } from '@/hooks/use-permissions';
import {
  useDiscoveredVendorActions,
  useDiscoveredVendors,
  type DiscoveredVendor,
  type DiscoveredVendorStatus,
} from '@/hooks/use-discovered-vendors';
import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApproveVendorSheet } from './ApproveVendorSheet';

interface DiscoveredVendorsTableProps {
  initialData?: DiscoveredVendor[];
  status?: DiscoveredVendorStatus;
}

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function DiscoveredVendorsTable({
  initialData,
  status = 'pending',
}: DiscoveredVendorsTableProps) {
  const { discoveredVendors, isLoading } = useDiscoveredVendors({ status, initialData });
  const { ignore, reopen, isSubmitting } = useDiscoveredVendorActions();
  const { hasPermission } = usePermissions();

  const canApprove = hasPermission('vendor', 'create');
  const canUpdate = hasPermission('vendor', 'update');

  const [approving, setApproving] = useState<DiscoveredVendor | null>(null);

  const handleIgnore = async (candidate: DiscoveredVendor) => {
    try {
      await ignore(candidate.id);
      toast.success(`${candidate.displayName ?? 'Application'} removed from the queue`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not ignore this application');
    }
  };

  const handleReopen = async (candidate: DiscoveredVendor) => {
    try {
      await reopen(candidate.id);
      toast.success('Returned to the review queue');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not reopen this application');
    }
  };

  if (!isLoading && discoveredVendors.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {status === 'pending' ? 'Nothing to review' : 'Nothing here yet'}
          </EmptyTitle>
          <EmptyDescription>
            {status === 'pending'
              ? 'Applications your team signs into with their work Google account will appear here for review.'
              : 'Applications you ignore will be listed here.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Stack gap="md">
      {/* Only Google sign-ins are visible — anything signed up for with a personal
          address or a password is invisible to this signal, and the queue must not
          imply it is a complete inventory. */}
      <Text variant="muted">
        Applications employees signed into with their work Google account. Apps signed up for
        another way will not appear here.
      </Text>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Application</TableHead>
            <TableHead>People</TableHead>
            <TableHead>First seen</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {discoveredVendors.map((candidate) => (
            <TableRow key={candidate.id}>
              <TableCell>
                <div className="min-w-0 max-w-xs">
                  <p className="truncate font-medium">
                    {candidate.resolvedName ??
                      candidate.displayName ??
                      'Unnamed application'}
                  </p>
                  {candidate.resolvedWebsite && (
                    <p className="truncate text-xs text-muted-foreground">
                      {candidate.resolvedWebsite.replace(/^https?:\/\//, '')}
                    </p>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div>
                  <Badge variant="outline">{candidate.granteeCount}</Badge>
                </div>
              </TableCell>
              <TableCell>
                <span className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDate(candidate.firstSeenAt)}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  {status === 'ignored'
                    ? canUpdate && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSubmitting}
                          onClick={() => handleReopen(candidate)}
                        >
                          Reopen
                        </Button>
                      )
                    : (
                      <>
                        {canUpdate && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSubmitting}
                            onClick={() => handleIgnore(candidate)}
                          >
                            Ignore
                          </Button>
                        )}
                        {canApprove && (
                          <Button
                            size="sm"
                            disabled={isSubmitting}
                            onClick={() => setApproving(candidate)}
                          >
                            Add vendor
                          </Button>
                        )}
                      </>
                    )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* No bulk-approve control: each approval triggers vendor research on a globally
          serialised queue, so approving a page at once would stall every organization's
          assessments behind this one. */}

      <ApproveVendorSheet
        candidate={approving}
        open={approving !== null}
        onOpenChange={(open) => !open && setApproving(null)}
      />
    </Stack>
  );
}
