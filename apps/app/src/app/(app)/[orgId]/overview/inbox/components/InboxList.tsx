'use client';

import type { InboxData } from '@/hooks/inbox-data';
import { useInbox } from '@/hooks/use-inbox';
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  ItemGroup,
  Skeleton,
  Stack,
  Text,
} from '@trycompai/design-system';
import { CheckmarkOutline, WarningAlt } from '@trycompai/design-system/icons';
import Link from 'next/link';
import { InboxItemRow } from './InboxItemRow';
import { countLabel, INBOX_KIND_ORDER, INBOX_KINDS } from './inbox-kinds';

function InboxSkeleton() {
  return (
    <Stack gap="sm" aria-busy="true" aria-label="Loading inbox">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} style={{ height: '4rem' }} />
      ))}
    </Stack>
  );
}

function InboxEmpty({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: 'clear' | 'warning';
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {icon === 'clear' ? <CheckmarkOutline size={24} /> : <WarningAlt size={24} />}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function InboxList({ orgId, initialData }: { orgId: string; initialData?: InboxData }) {
  const { items, totals, hasData, isLoading, error, refresh } = useInbox({ initialData });

  if (!hasData && isLoading) return <InboxSkeleton />;

  if (!hasData && error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningAlt size={24} />
          </EmptyMedia>
          <EmptyTitle>Couldn&apos;t load your inbox</EmptyTitle>
          <EmptyDescription>Check your connection and try again.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => refresh()}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const visibleKinds = INBOX_KIND_ORDER.filter((kind) => totals[kind] !== undefined);

  if (visibleKinds.length === 0) {
    return (
      <InboxEmpty
        icon="warning"
        title="Nothing to show for your role"
        description="The inbox tracks tasks, cloud tests, and integrations. Your role doesn't include access to any of them."
      />
    );
  }

  if (items.length === 0) {
    return (
      <InboxEmpty
        icon="clear"
        title="You're all caught up"
        description="Failing checks, cloud findings that fail again after a fix, and broken integrations will show up here."
      />
    );
  }

  const summary = visibleKinds
    .filter((kind) => (totals[kind] ?? 0) > 0)
    .map((kind) => countLabel({ kind, count: totals[kind] ?? 0 }))
    .join(' · ');

  const truncated = visibleKinds
    .map((kind) => ({
      kind,
      shown: items.filter((item) => item.kind === kind).length,
      total: totals[kind] ?? 0,
    }))
    .filter(({ shown, total }) => total > shown);

  return (
    <Stack gap="md">
      <Text size="sm" variant="muted">
        {summary}
      </Text>

      <ItemGroup>
        {items.map((item) => (
          <InboxItemRow key={item.key} item={item} orgId={orgId} />
        ))}
      </ItemGroup>

      {truncated.map(({ kind, shown, total }) => (
        <div key={kind} className="flex flex-wrap items-baseline gap-x-2">
          <Text as="span" size="sm" variant="muted">
            Showing {shown} of {countLabel({ kind, count: total })}.
          </Text>
          <Link
            href={`/${orgId}/${INBOX_KINDS[kind].viewAllPath}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            View all
          </Link>
        </div>
      ))}
    </Stack>
  );
}
