import { Badge, Card, Heading, Text } from '@/components/ds';
import { frameworkLabel, STATUS_LABELS } from '@/lib/frameworks';
import type { CustomFramework, Summary } from '@/lib/schemas';
import { CheckmarkFilled, InProgress } from '@trycompai/design-system/icons';

type Item = {
  key: string;
  label: string;
  status: keyof typeof STATUS_LABELS;
  badgeUrl?: string | null;
};

export function CertificationBadges(props: {
  certifications: Summary['certifications'];
  customFrameworks: CustomFramework[];
}) {
  const items: Item[] = [
    ...props.certifications.map((c) => ({
      key: c.framework,
      label: frameworkLabel(c.framework),
      status: c.status,
    })),
    ...props.customFrameworks.map((f) => ({
      key: f.id,
      label: f.name,
      status: f.status,
      badgeUrl: f.badgeUrl,
    })),
  ];

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="frameworks-heading" className="space-y-3">
      <Heading level="3">
        <span id="frameworks-heading">Compliance</span>
      </Heading>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.key} size="sm" radius="2xl" shadow="soft">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {item.badgeUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.badgeUrl} alt="" className="size-8 shrink-0 object-contain" />
                ) : null}
                <Text weight="medium">
                  <span className="block truncate">{item.label}</span>
                </Text>
              </div>
              <Badge variant={item.status === 'compliant' ? 'accent' : 'secondary'}>
                {item.status === 'compliant' ? <CheckmarkFilled /> : <InProgress />}
                {STATUS_LABELS[item.status]}
              </Badge>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
