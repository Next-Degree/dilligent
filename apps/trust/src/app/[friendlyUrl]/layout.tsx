import { PortalFooter } from '@/components/PortalFooter';
import { PortalHeader } from '@/components/PortalHeader';
import { getSummary } from '@/lib/portal-data';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ friendlyUrl: string }>;
};

export async function generateMetadata(props: {
  params: Promise<{ friendlyUrl: string }>;
}): Promise<Metadata> {
  const { friendlyUrl } = await props.params;
  const summary = await getSummary(friendlyUrl);
  if (!summary) return { title: 'Trust Center' };

  return {
    title: `${summary.organizationName} | Trust Center`,
    description: `Security, compliance and governance documentation for ${summary.organizationName}.`,
    icons: summary.faviconUrl ? { icon: summary.faviconUrl } : undefined,
  };
}

export default async function PortalLayout({ children, params }: LayoutProps) {
  const { friendlyUrl } = await params;
  const summary = await getSummary(friendlyUrl);
  if (!summary) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <PortalHeader summary={summary} />
      <div className="mx-auto w-full max-w-300 flex-1 px-4 py-6 sm:px-6 md:px-8">{children}</div>
      <PortalFooter />
    </div>
  );
}
