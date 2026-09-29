import { Card, Heading, Text } from '@/components/ds';
import type { Summary } from '@/lib/schemas';
import { CheckmarkFilled } from '@trycompai/design-system/icons';

export function ControlsSection({ controls }: { controls: Summary['controls'] }) {
  if (controls.length === 0) return null;

  return (
    <section className="space-y-3">
      <Heading level="3">Controls ({controls.length})</Heading>
      <Card>
        <ul className="grid max-h-96 grid-cols-1 gap-x-6 gap-y-2 overflow-y-auto md:grid-cols-2">
          {controls.map((control) => (
            <li key={control.id} className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 shrink-0 text-primary">
                <CheckmarkFilled />
              </span>
              <Text size="sm">
                <span className="wrap-break-word">{control.name}</span>
              </Text>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
