import { Badge, Heading, HStack } from '@/components/ds';
import type { Summary } from '@/lib/schemas';
import { CheckmarkFilled } from '@trycompai/design-system/icons';

const SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$/;

export function PortalHeader({ summary }: { summary: Summary }) {
  const accent =
    summary.primaryColor && SAFE_COLOR.test(summary.primaryColor)
      ? summary.primaryColor
      : undefined;

  return (
    <header
      className="border-b border-t-4 border-t-transparent"
      style={accent ? { borderTopColor: accent } : undefined}
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 2xl:max-w-6xl">
        <HStack gap="3" align="center">
          {summary.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={summary.logoUrl}
              alt={`${summary.organizationName} logo`}
              className="h-10 w-auto max-w-40 shrink-0 object-contain"
            />
          ) : null}
          <div className="min-w-0">
            <Heading level="3">
              <span className="block truncate">{summary.organizationName}</span>
            </Heading>
          </div>
          <Badge variant="accent" shape="pill">
            <CheckmarkFilled />
            Verified
          </Badge>
        </HStack>
      </div>
    </header>
  );
}
