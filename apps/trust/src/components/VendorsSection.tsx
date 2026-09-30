import { Badge, Card, Heading, Text } from '@/components/ds';
import type { Vendor } from '@/lib/schemas';
import { Launch } from '@trycompai/design-system/icons';

function safeHref(url: string | null): string | null {
  if (!url) return null;
  const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function VendorsSection({ vendors }: { vendors: Vendor[] }) {
  if (vendors.length === 0) return null;

  return (
    <section className="space-y-3">
      <Heading level="3">Subprocessors ({vendors.length})</Heading>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {vendors.map((vendor) => {
          const href = safeHref(vendor.trustPortalUrl ?? vendor.website);
          return (
            <Card key={vendor.id} size="sm" radius="2xl" shadow="soft">
              <div className="space-y-2">
                <div className="flex min-w-0 items-center gap-2">
                  {vendor.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={vendor.logoUrl} alt="" className="size-6 shrink-0 object-contain" />
                  ) : null}
                  <Text weight="medium">
                    <span className="block truncate">{vendor.name}</span>
                  </Text>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${vendor.name}`}
                      className="ml-auto inline-flex size-10 shrink-0 items-center justify-center"
                    >
                      <Launch />
                    </a>
                  ) : null}
                </div>
                {vendor.description ? (
                  <Text size="sm" variant="muted">
                    {vendor.description}
                  </Text>
                ) : null}
                {vendor.complianceBadges.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {vendor.complianceBadges.map((badge) => (
                      <Badge key={badge.type} variant="outline">
                        {badge.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
