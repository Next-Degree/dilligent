import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Heading,
  Text,
} from '@/components/ds';

type Faq = { id?: string; question: string; answer: string; order?: number };

export function FaqSection({ faqs }: { faqs: Faq[] }) {
  if (faqs.length === 0) return null;
  const sorted = [...faqs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <section className="space-y-3">
      <Heading level="3">Frequently asked questions</Heading>
      <Accordion variant="bordered">
        {sorted.map((faq, index) => (
          <AccordionItem key={faq.id ?? `${index}-${faq.question}`} value={faq.id ?? String(index)}>
            <AccordionTrigger>{faq.question}</AccordionTrigger>
            <AccordionContent>
              <Text size="sm" variant="muted" leading="relaxed">
                {faq.answer}
              </Text>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
