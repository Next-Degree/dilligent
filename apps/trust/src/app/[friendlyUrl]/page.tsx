import { AccessSection } from '@/components/AccessSection';
import { CertificationBadges } from '@/components/CertificationBadges';
import { ControlsSection } from '@/components/ControlsSection';
import { CustomLinksSection } from '@/components/CustomLinksSection';
import { FaqSection } from '@/components/FaqSection';
import { OverviewSection } from '@/components/OverviewSection';
import { PoliciesSection } from '@/components/PoliciesSection';
import { PortalTabs } from '@/components/PortalTabs';
import { StatTiles } from '@/components/StatTiles';
import { VendorsSection } from '@/components/VendorsSection';
import { getPortalSections, getSummary } from '@/lib/portal-data';
import { notFound } from 'next/navigation';

// Regenerated from the API at most once a minute per portal.
export const revalidate = 60;

export default async function PortalPage(props: { params: Promise<{ friendlyUrl: string }> }) {
  const { friendlyUrl } = await props.params;
  const summary = await getSummary(friendlyUrl);
  if (!summary) notFound();

  const sections = await getPortalSections(friendlyUrl);

  return (
    <PortalTabs
      overview={
        <>
          <OverviewSection overview={sections.overview} />
          <StatTiles stats={summary.stats} />
          <CertificationBadges
            certifications={summary.certifications}
            customFrameworks={sections.customFrameworks}
          />
          <PoliciesSection policies={summary.policies} />
          <ControlsSection controls={summary.controls} />
          <VendorsSection vendors={sections.vendors} />
          <CustomLinksSection links={sections.links} />
          <FaqSection faqs={sections.faqs} />
        </>
      }
      access={
        <AccessSection
          friendlyUrl={summary.friendlyUrl}
          organizationName={summary.organizationName}
        />
      }
    />
  );
}
