import { Card, Heading, Text } from '@/components/ds';
import { Launch } from '@trycompai/design-system/icons';

type Link = { id: string; title: string; description: string | null; url: string };

const isHttp = (url: string) => /^https?:\/\//i.test(url);

export function CustomLinksSection({ links }: { links: Link[] }) {
  const safeLinks = links.filter((link) => isHttp(link.url));
  if (safeLinks.length === 0) return null;

  return (
    <section className="space-y-3">
      <Heading level="3">Resources</Heading>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {safeLinks.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block min-w-0"
          >
            <Card size="sm" radius="2xl" shadow="soft">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <Text weight="medium">
                  <span className="block truncate">{link.title}</span>
                </Text>
                <Launch />
              </div>
              {link.description ? (
                <Text size="sm" variant="muted">
                  {link.description}
                </Text>
              ) : null}
            </Card>
          </a>
        ))}
      </div>
    </section>
  );
}
