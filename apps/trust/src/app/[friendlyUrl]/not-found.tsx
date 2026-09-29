import { Heading, Text, VStack } from '@/components/ds';

export default function PortalNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4">
      <VStack gap="2">
        <Heading level="2">Trust portal not found</Heading>
        <Text variant="muted">This trust portal does not exist or has not been published yet.</Text>
      </VStack>
    </main>
  );
}
