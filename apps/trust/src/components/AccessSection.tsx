import { Heading, Text } from '@/components/ds';
import { ReclaimForm } from './forms/ReclaimForm';
import { RequestAccessForm } from './forms/RequestAccessForm';

export function AccessSection(props: { friendlyUrl: string; organizationName: string }) {
  const { friendlyUrl, organizationName } = props;
  return (
    <>
      <section className="space-y-3">
        <Heading level="2">Request access to documents</Heading>
        <div className="max-w-2xl">
          <Text variant="muted">
            Tell {organizationName} who you are. Once approved you can download policies,
            certificates and additional security documents.
          </Text>
        </div>
        <RequestAccessForm friendlyUrl={friendlyUrl} />
      </section>
      <section className="space-y-3">
        <Heading level="3">Already have access?</Heading>
        <ReclaimForm friendlyUrl={friendlyUrl} />
      </section>
    </>
  );
}
