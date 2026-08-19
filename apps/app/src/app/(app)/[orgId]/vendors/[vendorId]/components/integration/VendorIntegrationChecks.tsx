'use client';

import { formatDate } from '@/lib/format';
import type { VendorIntegrationCheck } from '@/hooks/use-vendor-integration';
import {
  Badge,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Section,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';

/** Run statuses that mean "the check completed and found problems". */
const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled']);

function runBadge(check: VendorIntegrationCheck) {
  if (!check.lastRun) return <Badge variant="outline">Not run yet</Badge>;
  if (FAILED_STATUSES.has(check.lastRun.status)) {
    return <Badge variant="destructive">{check.lastRun.status}</Badge>;
  }
  if (check.lastRun.failedCount > 0) {
    return <Badge variant="destructive">{check.lastRun.failedCount} failing</Badge>;
  }
  return <Badge variant="default">Passing</Badge>;
}

interface VendorIntegrationChecksProps {
  integrationName: string;
  checks: VendorIntegrationCheck[];
}

/**
 * The checks the vendor's connected integration runs, each with the outcome of
 * its most recent real run.
 */
export function VendorIntegrationChecks({
  integrationName,
  checks,
}: VendorIntegrationChecksProps) {
  return (
    <Section
      title="Checks"
      description={`Compliance checks ${integrationName} runs against this vendor.`}
    >
      {checks.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No checks available</EmptyTitle>
            <EmptyDescription>
              This integration does not publish any compliance checks yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table variant="bordered">
          <TableHeader>
            <TableRow>
              <TableHead>Check</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Resources</TableHead>
              <TableHead>Last run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map((check) => (
              <TableRow key={check.checkId}>
                <TableCell>
                  <div className="min-w-0 max-w-xs sm:max-w-sm md:max-w-md">
                    <span className="block truncate text-sm font-medium" title={check.name}>
                      {check.name}
                    </span>
                    {check.description && (
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={check.description}
                      >
                        {check.description}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{runBadge(check)}</TableCell>
                <TableCell>
                  <Text size="sm" variant="muted">
                    {check.lastRun
                      ? `${check.lastRun.passedCount} passed · ${check.lastRun.failedCount} failed`
                      : '—'}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text size="sm" variant="muted">
                    {check.lastRun?.completedAt
                      ? formatDate(check.lastRun.completedAt)
                      : '—'}
                  </Text>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
