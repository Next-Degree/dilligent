import { DownloadButton } from '@/components/DownloadButton';
import { Alert, AlertDescription, Card, Heading, Text } from '@/components/ds';
import { fetchTrust } from '@/lib/api';
import { frameworkLabel } from '@/lib/frameworks';
import {
  accessDocumentsSchema,
  accessPoliciesSchema,
  accessResourcesSchema,
  grantSchema,
} from '@/lib/schemas';
import type { Metadata } from 'next';

// Token gated and per-viewer: never cache or index.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Params = { friendlyUrl: string; token: string };

export default async function AccessPage(props: { params: Promise<Params> }) {
  const { token } = await props.params;
  const enc = encodeURIComponent(token);
  const options = { revalidate: 0 } as const;

  const grant = await fetchTrust({ path: `/access/${enc}`, schema: grantSchema, ...options });
  if (!grant.ok) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          This access link is invalid or has expired. Use “Already have access?” on the portal to
          get a new one.
        </AlertDescription>
      </Alert>
    );
  }

  const [policies, documents, resources] = await Promise.all([
    fetchTrust({ path: `/access/${enc}/policies`, schema: accessPoliciesSchema, ...options }),
    fetchTrust({ path: `/access/${enc}/documents`, schema: accessDocumentsSchema, ...options }),
    fetchTrust({
      path: `/access/${enc}/compliance-resources`,
      schema: accessResourcesSchema,
      ...options,
    }),
  ]);
  const policyList = policies.ok ? policies.data : [];
  const documentList = documents.ok ? documents.data : [];
  const resourceList = resources.ok ? resources.data : [];

  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <Heading level="2">{grant.data.organizationName} documents</Heading>
        <Text variant="muted">
          Signed in as {grant.data.subjectEmail}. Access expires{' '}
          {new Date(grant.data.expiresAt).toLocaleDateString()}. Downloads are watermarked with your
          details.
        </Text>
      </section>

      <Section title="Policies" show={policyList.length > 0}>
        <DownloadButton
          path={`access/${enc}/policies/download-all`}
          label="Download all policies"
          variant="default"
        />
        {policyList.map((policy) => (
          <Row key={policy.id} name={policy.name} description={policy.description}>
            <DownloadButton
              path={`access/${enc}/policies/${encodeURIComponent(policy.id)}/download`}
              label="Download"
            />
          </Row>
        ))}
      </Section>

      <Section title="Certificates" show={resourceList.length > 0}>
        {resourceList.map((resource) => {
          const key = resource.customFrameworkId ?? resource.framework;
          if (!key) return null;
          const path = resource.customFrameworkId
            ? `custom/${encodeURIComponent(resource.customFrameworkId)}`
            : encodeURIComponent(key);
          const name = resource.customFrameworkName ?? frameworkLabel(key);
          return (
            <Row key={key} name={name} description={resource.fileName}>
              <DownloadButton
                path={`access/${enc}/compliance-resources/${path}`}
                label="Download"
              />
            </Row>
          );
        })}
      </Section>

      <Section title="Additional documents" show={documentList.length > 0}>
        <DownloadButton
          path={`access/${enc}/documents/download-all`}
          label="Download all documents"
          variant="default"
        />
        {documentList.map((doc) => (
          <Row key={doc.id} name={doc.name} description={doc.description}>
            <DownloadButton
              path={`access/${enc}/documents/${encodeURIComponent(doc.id)}`}
              label="Download"
            />
          </Row>
        ))}
      </Section>
    </div>
  );
}

function Section(props: { title: string; show: boolean; children: React.ReactNode }) {
  if (!props.show) return null;
  return (
    <section className="space-y-3">
      <Heading level="3">{props.title}</Heading>
      <div className="space-y-3">{props.children}</div>
    </section>
  );
}

function Row(props: { name: string; description: string | null; children: React.ReactNode }) {
  return (
    <Card size="sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Text weight="medium">
            <span className="block wrap-break-word">{props.name}</span>
          </Text>
          {props.description ? (
            <Text size="sm" variant="muted">
              <span className="block wrap-break-word">{props.description}</span>
            </Text>
          ) : null}
        </div>
        {props.children}
      </div>
    </Card>
  );
}
