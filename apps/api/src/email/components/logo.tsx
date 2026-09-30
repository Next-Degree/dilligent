import { Img, Section } from '@react-email/components';

export function Logo() {
  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://portal.trycomp.ai';

  return (
    <Section className="mt-[32px]">
      <Img
        src={`${portalUrl}/dilligent-logo.png`}
        width="45"
        height="45"
        alt="Dilligent"
        className="mx-auto my-0 block"
      />
    </Section>
  );
}
