import { z } from 'zod';

const status = z.enum(['started', 'in_progress', 'compliant']);

export const summarySchema = z.object({
  friendlyUrl: z.string(),
  organizationName: z.string(),
  logoUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  website: z.string().nullable(),
  certifications: z.array(z.object({ framework: z.string(), status })),
  stats: z.object({
    policies: z.number(),
    frameworks: z.number(),
    controls: z.number(),
    subprocessors: z.number(),
  }),
  policies: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
    }),
  ),
  controls: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const overviewSchema = z
  .object({ title: z.string().nullable(), content: z.string().nullable() })
  .nullable();

export const faqsSchema = z.object({
  faqs: z
    .array(
      z.object({
        id: z.string().optional(),
        question: z.string(),
        answer: z.string(),
        order: z.number().optional(),
      }),
    )
    .nullable(),
});

export const vendorsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    website: z.string().nullable(),
    logoUrl: z.string().nullable(),
    trustPortalUrl: z.string().nullable(),
    complianceBadges: z.array(z.object({ type: z.string(), label: z.string() })),
  }),
);

export const customLinksSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    url: z.string(),
  }),
);

export const customFrameworksSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    status,
    hasCertificate: z.boolean(),
    badgeUrl: z.string().nullable(),
  }),
);

export const questionnaireSchema = z.object({ enabled: z.boolean() });
export const resolveDomainSchema = z.object({ friendlyUrl: z.string() });

export const grantSchema = z.object({
  organizationName: z.string(),
  friendlyUrl: z.string(),
  faviconUrl: z.string().nullable(),
  expiresAt: z.string(),
  subjectEmail: z.string(),
  ndaPdfUrl: z.string().nullable(),
});

export const accessPoliciesSchema = z.array(
  z.object({ id: z.string(), name: z.string(), description: z.string().nullable() }),
);

export const accessDocumentsSchema = z.array(
  z.object({ id: z.string(), name: z.string(), description: z.string().nullable() }),
);

export const accessResourcesSchema = z.array(
  z.object({
    framework: z.string().nullable(),
    customFrameworkId: z.string().nullable(),
    customFrameworkName: z.string().nullable(),
    fileName: z.string(),
  }),
);

export const ndaSchema = z.object({
  organizationName: z.string(),
  friendlyUrl: z.string(),
  requesterName: z.string(),
  requesterEmail: z.string(),
  status: z.enum(['pending', 'signed', 'expired', 'void']),
  message: z.string().optional(),
  portalUrl: z.string().nullable(),
});

/** Download endpoints return either `signedUrl` or `downloadUrl`. */
export const downloadSchema = z
  .object({
    signedUrl: z.string().optional(),
    downloadUrl: z.string().optional(),
  })
  .transform((value) => value.signedUrl ?? value.downloadUrl ?? null);

export type Summary = z.infer<typeof summarySchema>;
export type Vendor = z.infer<typeof vendorsSchema>[number];
export type CustomFramework = z.infer<typeof customFrameworksSchema>[number];
export type Nda = z.infer<typeof ndaSchema>;
export type Grant = z.infer<typeof grantSchema>;

export const ndaActionSchema = z.object({
  pdfDownloadUrl: z.string().nullable().optional(),
  portalUrl: z.string().nullable().optional(),
});
