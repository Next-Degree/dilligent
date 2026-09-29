import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Heading,
  Text,
} from '@/components/ds';
import type { Summary } from '@/lib/schemas';

export function PoliciesSection({ policies }: { policies: Summary['policies'] }) {
  if (policies.length === 0) return null;

  return (
    <section className="space-y-3">
      <Heading level="3">Policies ({policies.length})</Heading>
      <Accordion variant="bordered">
        {policies.map((policy) => (
          <AccordionItem key={policy.id} value={policy.id}>
            <AccordionTrigger>{policy.name}</AccordionTrigger>
            <AccordionContent>
              <Text size="sm" variant="muted">
                {policy.description ??
                  'Available for download after your access request is approved.'}
              </Text>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
