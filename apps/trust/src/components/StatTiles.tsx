import { Card, Heading, Text } from '@/components/ds';
import type { Summary } from '@/lib/schemas';

export function StatTiles({ stats }: { stats: Summary['stats'] }) {
  const tiles = [
    { label: 'Policies', value: stats.policies },
    { label: 'Frameworks', value: stats.frameworks },
    { label: 'Controls', value: stats.controls },
    { label: 'Subprocessors', value: stats.subprocessors },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} size="sm" radius="2xl" shadow="soft">
          <Heading level="2">{tile.value}</Heading>
          <Text size="sm" variant="muted">
            {tile.label}
          </Text>
        </Card>
      ))}
    </div>
  );
}
