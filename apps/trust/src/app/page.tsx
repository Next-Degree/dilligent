import { Heading, Text, VStack } from '@/components/ds';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4">
      <VStack gap="2">
        <Heading level="2">Trust Center</Heading>
        <Text variant="muted">
          Open a trust portal by visiting /your-portal-name, or through the custom domain your
          vendor shared with you.
        </Text>
      </VStack>
    </main>
  );
}
