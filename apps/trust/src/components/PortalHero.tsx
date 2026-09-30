import { Text } from '@/components/ds';

export function PortalHero({ organizationName }: { organizationName: string }) {
  return (
    <section className="space-y-3 pb-2 pt-6 md:pt-10">
      <h1 className="text-4xl leading-[1.1] text-foreground md:text-6xl">Trust Center</h1>
      <div className="max-w-2xl">
        <Text size="lg" variant="muted" leading="relaxed">
          Transparent visibility into {organizationName}&apos;s security, compliance and governance
          documentation.
        </Text>
      </div>
    </section>
  );
}
