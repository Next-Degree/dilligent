'use client';

import type { InboxItem } from '@/hooks/inbox-data';
import { Badge, Item, ItemContent, ItemMedia, Text } from '@trycompai/design-system';
import { ChevronRight } from '@trycompai/design-system/icons';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { INBOX_KINDS, SEVERITY_LABEL, SEVERITY_TONE } from './inbox-kinds';

function RelativeTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // Relative text drifts between the server render and hydration.
  return (
    <time dateTime={iso} title={date.toLocaleString()} suppressHydrationWarning>
      {formatDistanceToNow(date, { addSuffix: true })}
    </time>
  );
}

export function InboxItemRow({ item, orgId }: { item: InboxItem; orgId: string }) {
  const kind = INBOX_KINDS[item.kind];
  const Icon = kind.icon;

  return (
    <Item variant="outline" size="sm" render={<Link href={`/${orgId}/${item.path}`} />}>
      <ItemMedia variant="icon">
        <span className={SEVERITY_TONE[item.severity]} aria-hidden>
          <Icon size={16} />
        </span>
      </ItemMedia>

      <div className="min-w-0 flex-1">
        <ItemContent>
          <div className="truncate">
            <span className="sr-only">{SEVERITY_LABEL[item.severity]}: </span>
            <Text as="span" size="sm" weight="medium">
              {item.title}
            </Text>
          </div>
          <div className="line-clamp-2 [overflow-wrap:anywhere]">
            <Text as="span" size="sm" variant="muted">
              {item.detail}
            </Text>
          </div>
          {/* Below lg the sidebar leaves the list too narrow for a side column,
              so metadata folds under the text instead of squeezing it. */}
          <div className="lg:hidden">
            <Text as="span" size="xs" variant="muted">
              {kind.label} · <RelativeTime iso={item.occurredAt} />
            </Text>
          </div>
        </ItemContent>
      </div>

      <div className="hidden shrink-0 items-center gap-3 lg:flex">
        <Badge variant="secondary">{kind.label}</Badge>
        <div className="min-w-24 whitespace-nowrap text-right">
          <Text as="span" size="xs" variant="muted">
            <RelativeTime iso={item.occurredAt} />
          </Text>
        </div>
        <span className="text-muted-foreground" aria-hidden>
          <ChevronRight size={16} />
        </span>
      </div>
    </Item>
  );
}
