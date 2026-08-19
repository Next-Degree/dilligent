'use client';

import { formatDate } from '@/lib/format';
import type { VendorIntegrationUser } from '@/hooks/use-vendor-integration';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
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

const displayName = (user: VendorIntegrationUser): string =>
  user.member?.name ?? user.name ?? user.email ?? user.resourceId;

const initials = (value: string): string =>
  value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

interface VendorIntegrationUsersProps {
  integrationName: string;
  users: VendorIntegrationUser[];
}

/**
 * The people the vendor's connected integration reports access for.
 *
 * Rows come from the integration's own access checks, so this is who actually
 * has the vendor today — matched to org members by email where possible, and
 * shown as an unmatched external account where not.
 */
export function VendorIntegrationUsers({
  integrationName,
  users,
}: VendorIntegrationUsersProps) {
  return (
    <Section
      title={`Users (${users.length})`}
      description={`People ${integrationName} reports as having access to this vendor.`}
    >
      {users.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No users reported</EmptyTitle>
            <EmptyDescription>
              This integration&apos;s checks have not reported per-person access yet.
              Run its access check to populate this list.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table variant="bordered">
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reported by</TableHead>
              <TableHead>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const name = displayName(user);
              return (
                <TableRow key={user.resourceId}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar size="sm">
                        {user.member?.image && (
                          <AvatarImage src={user.member.image} alt={name} />
                        )}
                        <AvatarFallback>{initials(name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 max-w-[10rem] sm:max-w-xs">
                        <span className="block truncate text-sm font-medium" title={name}>
                          {name}
                        </span>
                        <span
                          className="block truncate text-xs text-muted-foreground"
                          title={user.email ?? user.resourceId}
                        >
                          {user.email ?? user.resourceId}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {user.isAdmin && <Badge variant="secondary">Admin</Badge>}
                      {user.role ? (
                        <Badge variant="outline">{user.role}</Badge>
                      ) : (
                        !user.isAdmin && (
                          <Text size="sm" variant="muted">
                            —
                          </Text>
                        )
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {!user.passed ? (
                      <Badge variant="destructive">Flagged</Badge>
                    ) : user.member ? (
                      user.member.deactivated ? (
                        <Badge variant="destructive">Offboarded</Badge>
                      ) : (
                        <Badge variant="outline">{user.status ?? 'Active'}</Badge>
                      )
                    ) : (
                      <Badge variant="secondary">Not a member</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[14rem] flex-wrap items-center gap-1">
                      {user.checks.map((check) => (
                        <Badge key={check.checkId} variant="outline">
                          {check.checkName}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Text size="sm" variant="muted">
                      {user.lastLogin ? formatDate(user.lastLogin) : '—'}
                    </Text>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
