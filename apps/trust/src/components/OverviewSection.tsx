import { Heading, Text } from '@/components/ds';
import { renderInline, splitParagraphs } from '@/lib/markdown-lite';

type Props = { overview: { title: string | null; content: string | null } | null };

export function OverviewSection({ overview }: Props) {
  if (!overview?.content) return null;

  return (
    <section className="space-y-3">
      {overview.title ? <Heading level="2">{overview.title}</Heading> : null}
      <div className="max-w-3xl space-y-3 [&_a]:underline [&_a]:underline-offset-4">
        {splitParagraphs(overview.content).map((paragraph) => (
          <Text key={paragraph} variant="muted" leading="relaxed">
            {renderInline(paragraph)}
          </Text>
        ))}
      </div>
    </section>
  );
}
