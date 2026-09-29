import { Alert, AlertDescription, Heading, Text } from '@/components/ds';
import { NdaForm } from '@/components/forms/NdaForm';
import { fetchTrust } from '@/lib/api';
import { ndaSchema } from '@/lib/schemas';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sign NDA',
  robots: { index: false, follow: false },
};

export default async function NdaPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const result = await fetchTrust({
    path: `/nda/${encodeURIComponent(token)}`,
    schema: ndaSchema,
    revalidate: 0,
  });

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 sm:px-6">
      {!result.ok ? (
        <Alert variant="destructive">
          <AlertDescription>This NDA link is invalid.</AlertDescription>
        </Alert>
      ) : result.data.status !== 'pending' ? (
        <Alert variant={result.data.status === 'signed' ? 'success' : 'destructive'}>
          <AlertDescription>
            {result.data.message ?? 'This NDA is no longer available.'}
            {result.data.status === 'signed' && result.data.portalUrl ? (
              <>
                {' '}
                <a href={result.data.portalUrl} className="underline underline-offset-4">
                  Open documents
                </a>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="space-y-2">
            <Heading level="2">Sign the {result.data.organizationName} NDA</Heading>
            <Text variant="muted">
              Review and sign the agreement to unlock the trust portal documents.
            </Text>
          </div>
          <NdaForm
            token={token}
            defaultName={result.data.requesterName}
            defaultEmail={result.data.requesterEmail}
          />
        </>
      )}
    </main>
  );
}
