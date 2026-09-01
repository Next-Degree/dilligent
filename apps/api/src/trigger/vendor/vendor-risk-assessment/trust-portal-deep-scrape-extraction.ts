import { logger } from '@trigger.dev/sdk';
import { generateObject } from 'ai';
import { z } from 'zod';
import { gateway } from './ai-gateway';
import type { VendorRiskAssessmentCertificationStatus } from './agent-types';

const EXTRACTION_MODEL = 'anthropic/claude-sonnet-4-6';
const MARKDOWN_TRUNCATE_LIMIT = 200_000;

const certificationExtractionSchema = z.object({
  certifications: z
    .array(
      z.object({
        type: z
          .string()
          .describe(
            'Canonical certification name, e.g. "SOC 2 Type II", "ISO 27001", "PCI DSS", "ISO 27017", "FedRAMP", "HIPAA", "GDPR", "ISO 42001"',
          ),
        status: z
          .enum(['verified', 'expired', 'not_certified', 'unknown'])
          .describe(
            'verified when the page lists this framework as current; expired only if explicitly said so; not_certified only if the page explicitly says so; unknown otherwise',
          ),
        issued_at: z.string().optional().nullable(),
        expires_at: z.string().optional().nullable(),
        evidence_snippet: z
          .string()
          .describe(
            'Short quote from the markdown (< 200 chars) that supports this certification. Must be present in the markdown verbatim.',
          ),
      }),
    )
    .default([]),
});

export type ExtractedCertification = {
  type: string;
  status: VendorRiskAssessmentCertificationStatus;
  issued_at?: string | null;
  expires_at?: string | null;
  evidence_snippet: string;
};

export function truncateMarkdown(input: string): string {
  if (input.length <= MARKDOWN_TRUNCATE_LIMIT) return input;
  logger.warn('Trust portal combined markdown truncated for extraction', {
    originalLength: input.length,
    limit: MARKDOWN_TRUNCATE_LIMIT,
  });
  return input.slice(0, MARKDOWN_TRUNCATE_LIMIT);
}

function buildExtractionPrompt(args: {
  vendorName: string;
  combinedMarkdown: string;
}): string {
  return `You are extracting security and compliance certifications from a vendor's trust center page.

Vendor: ${args.vendorName}

Rules:
- Only return certifications that are explicitly listed in the markdown below.
- Never invent certifications. If a certification is not mentioned, do not include it.
- Mark status as "verified" when the page lists it as a current/active framework (including badge callouts and "we are certified" language).
- Mark status as "expired" only when the page explicitly says the certification has lapsed.
- Mark status as "not_certified" only when the page explicitly says the vendor is not certified.
- Otherwise use "unknown".
- Normalize the type name to canonical form (e.g. "Soc 2 Type II" → "SOC 2 Type II", "ISO/IEC 27001:2013" → "ISO 27001", "PCI-DSS" → "PCI DSS").
- Always include evidence_snippet with a verbatim quote from the markdown. Certifications without an evidence_snippet will be discarded.

Markdown from the trust portal and its sections:

${args.combinedMarkdown}`;
}

export async function extractCertificationsFromMarkdown(params: {
  vendorName: string;
  combinedMarkdown: string;
}): Promise<{ certifications: ExtractedCertification[] } | null> {
  try {
    const { object } = await generateObject({
      model: gateway(EXTRACTION_MODEL),
      schema: certificationExtractionSchema,
      prompt: buildExtractionPrompt(params),
    });
    return object;
  } catch (error) {
    logger.warn('Trust portal deep-scrape: AI extraction failed', {
      vendorName: params.vendorName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
