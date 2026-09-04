// Pure prompt + input-assembly logic for the auditor content generation task
// (see ./generate-auditor-content.ts). Kept dependency-free (no DB / AI /
// Trigger.dev imports) so the prompt contract and prompt assembly can be unit
// tested in isolation. See CS-589.

import {
  EXTERNALLY_HOSTED_DELIVERY_MODELS,
  VENDOR_CATEGORY_LABELS,
  vendorDeliveryModelLabel,
} from '@trycompai/utils/vendors';

export const SECTIONS = [
  'company-background',
  'services',
  'mission-vision',
  'system-description',
  'critical-vendors',
  'subservice-organizations',
] as const;

export type Section = (typeof SECTIONS)[number];

// Map from section keys to Context question strings
export const SECTION_QUESTIONS: Record<Section, string> = {
  'company-background': 'Company Background & Overview of Operations',
  services: 'Types of Services Provided',
  'mission-vision': 'Mission & Vision',
  'system-description': 'System Description',
  'critical-vendors': 'Critical Vendors',
  'subservice-organizations': 'Subservice Organizations',
};

// Onboarding Q&A whose answers carry headcount or named-personnel data (team
// size, C-Suite executives, the report signatory's name/title/email). These
// must never reach the generation prompts: SOC 2 narrative fields are lifted
// verbatim into the customer report, and prompt-level exclusions alone are not
// a hard guarantee, so the raw values are stripped from the model's context
// entirely. Strings match the onboarding step questions (setup/lib/constants.ts)
// and the executive-context backfill task. See CS-589.
export const SENSITIVE_CONTEXT_QUESTIONS: readonly string[] = [
  'How many employees do you have?',
  'Who are your C-Suite executives?',
  'Who will sign off on the final report?',
];

// The narrative (prose) sections — exclusions/word guidance apply to these, but
// NOT to the two list sections (critical-vendors, subservice-organizations).
export const NARRATIVE_SECTIONS: readonly Section[] = [
  'company-background',
  'services',
  'mission-vision',
  'system-description',
];

// Shared tone rules — applied to every section.
export const TONE_RULES = `
TONE:
- Direct, declarative voice. State facts without attribution.
- No hedging ("may", "might", "likely", "appears").
- No meta phrases ("the website says", "according to", "it appears").
- Third person, simple present tense.
- NEVER mention missing information - only write about what IS available.
`;

// Exclusions for the narrative (prose) sections only — NOT the vendor list
// sections, which are intentionally formatted lists. SOC 2 narrative fields are
// lifted verbatim into the customer's report, so headcount and named personnel
// must never appear. See CS-589.
export const NARRATIVE_EXCLUSIONS = `
EXCLUSIONS (strict):
- Do NOT state the number of employees or headcount.
- Do NOT name any individuals or cite their roles/titles (no "led by CEO <name>", no founder or executive names, no personnel or org-chart detail).
- No marketing language, value judgments, tables, bullet lists, citations, or URLs.
`;

// The delivery models that place a workload outside the company's perimeter,
// rendered from the same constant `isExternallyHostedVendor` scopes on. The
// prompt used to re-type the membership as prose and had already lost
// `api_service`, so a vendor recorded as an API Service silently failed a rule
// it should have passed.
const EXTERNALLY_HOSTED_DELIVERY_MODEL_NAMES = EXTERNALLY_HOSTED_DELIVERY_MODELS.map(
  vendorDeliveryModelLabel,
).join(', ');

export const sectionPrompts: Record<Section, string> = {
  'company-background': `Write ONE paragraph (~80 words) describing the company background and operations.

INCLUDE (where available): company name, what they do, headquarters location, certifications, operational scope, and infrastructure/architecture facts.

EXAMPLE:
"[Company] is a [type of business] headquartered in [location], with operations serving [markets/regions]. It operates [products/services] that [what they do]. It holds [certifications]. Its services run on [infrastructure/architecture]."

RULES:
- Do NOT include the section title.
- ONE paragraph only, ~80 words.
- No bullet points.
${NARRATIVE_EXCLUSIONS}${TONE_RULES}`,

  services: `Write ONE paragraph (~60 words) describing the services/products provided.

INCLUDE (where available): service categories, specific service types, technology approach, target markets, business model aspects.

EXAMPLE:
"The company provides [service categories] including [specific services]. It also emphasises [technology/methodology approach]. Its service model includes [business model details]."

RULES:
- Do NOT include the section title.
- ONE paragraph only, ~60 words.
- No bullet points.
${NARRATIVE_EXCLUSIONS}${TONE_RULES}`,

  'mission-vision': `Write ONE paragraph (~60 words) describing mission and vision.

USE THIS STRUCTURE:
"[Company] positions its mission around [mission focus], with an emphasis on [key values]. It envisions [vision/strategy for the future]."

RULES:
- Do NOT include the section title.
- ONE paragraph only, ~60 words.
- Use "positions its mission around" and "envisions" phrasing.
- No bullet points.
${NARRATIVE_EXCLUSIONS}${TONE_RULES}`,

  'system-description': `Write ONE paragraph (~80 words) describing the technical infrastructure.

USE THIS STRUCTURE:
"[Company] operates a [type of architecture] where [what flows] from [sources] through [network components], via [security/routing], to [destinations/segments]. External connectivity includes [integrations/platforms], and hosting includes [cloud/on-prem infrastructure]."

Use parentheticals for specifics: "(including X, Y, Z)".

RULES:
- Do NOT include the section title.
- ONE paragraph only, ~80 words.
- Describe the FLOW of data/operations through infrastructure.
- No bullet points.
${NARRATIVE_EXCLUSIONS}${TONE_RULES}`,

  'critical-vendors': `List the company's critical vendors for the SOC 2 audit report from the VENDORS TAB provided in the sources.

Include EVERY vendor listed in the VENDORS TAB. Do NOT shorten the list, do NOT omit any vendor, and do NOT add vendors that are not in the VENDORS TAB.

Every VENDORS TAB entry already carries the company's recorded classification: its functional category — what the vendor does — and, where recorded, its delivery model — how the company consumes it, such as SaaS, Cloud Service, API Service, Managed Service, Open Source or Desktop Application. Use those recorded values exactly as written. Do NOT re-derive them, and do NOT translate them into a SaaS/PaaS/IaaS bucket: that scheme mixes what a vendor does with how it is delivered, and it is not what the company recorded.

Describe each vendor's function from its name and its recorded category. Identify the vendor from its name and state what that named product or service is widely known to do — the vendor's name is a sufficient basis for a concise, factual function. Never leave the function blank, and never restate onboarding metadata (for example "selected during onboarding") as the function.

FORMAT — one vendor per line:
[Vendor Name] - [recorded delivery model, or the recorded category when no delivery model is recorded] - [brief function]

EXAMPLE — here the recorded delivery models are Cloud Service, Cloud Service and SaaS:
Vercel - Cloud Service - Application hosting
AWS - Cloud Service - Cloud infrastructure
Slack - SaaS - Team messaging

RULES:
- Do NOT include the section title.
- One vendor per line, in the exact format above.
- The VENDORS TAB is the source of truth both for which vendors to list and for how each is classified — include all of them, invent none.
- The function must be a real description of what the vendor does — never onboarding placeholder text, "unknown", or a blank.
${TONE_RULES}`,

  'subservice-organizations': `Identify the subservice organisations for the SOC 2 report, choosing ONLY from the VENDORS TAB provided in the sources.

A subservice organisation is a vendor the VENDORS TAB records under the functional category "${VENDOR_CATEGORY_LABELS.cloud_infrastructure}" — compute, storage, networking, managed database, application hosting — AND with an externally-hosted delivery model (${EXTERNALLY_HOSTED_DELIVERY_MODEL_NAMES}) where the vendor hosts the company's in-scope application or its data. Both halves must hold. The recorded category establishes that the vendor supplies infrastructure; the recorded delivery model establishes that the company's system runs on the vendor's platform rather than its own. Typical examples: AWS, Microsoft Azure, Google Cloud Platform, Vercel, Neon, Render, Fly.io.

Read the classification from the VENDORS TAB rather than inferring it. Never qualify a vendor on its delivery model alone — nearly every tool the company uses is delivered as SaaS, and almost none of them host the in-scope system.

NEVER include:
- Identity / SSO / internal sign-in tools (e.g. Google Workspace, Okta, Microsoft Entra ID, Microsoft 365) — even when cloud-based, and even when they carry an externally-hosted delivery model. Their recorded category is ${VENDOR_CATEGORY_LABELS.identity_access_management}, not ${VENDOR_CATEGORY_LABELS.cloud_infrastructure}.
- Vendors recorded under any other functional category, which the company merely uses (chat, email, AI APIs, CRM, finance, source control, documentation, monitoring, analytics).

Choose only vendors that appear in the VENDORS TAB. If NO vendor in the VENDORS TAB is recorded as ${VENDOR_CATEGORY_LABELS.cloud_infrastructure} with an externally-hosted delivery model, return an empty list — do NOT invent one.

FORMAT:
Subservice organisations: [Name1], [Name2], ...

If none qualify: "Subservice organisations: none"

EXAMPLE:
Subservice organisations: Google Cloud Platform

RULES:
- Do NOT include the section title.
- Use the "Subservice organisations:" prefix.
- List only the names of ${VENDOR_CATEGORY_LABELS.cloud_infrastructure} vendors taken from the VENDORS TAB.
${TONE_RULES}`,
};

export const AUDITOR_SYSTEM_PROMPT = `You are an expert at extracting and organizing company information for audit purposes.

CRITICAL RULES:
1. ONLY use information EXPLICITLY stated in the provided sources.
2. DO NOT make up, infer, or hallucinate ANY information.
3. DO NOT add generic industry information not explicitly mentioned.
4. Write in third person and simple present tense.
5. Be concise and factual.

ABSOLUTELY FORBIDDEN:
- NEVER say "information not found", "not available", "no data provided", "could not be determined", or ANY similar phrases.
- NEVER use hedging words: "may", "might", "likely", "appears", "seems".
- NEVER use attribution phrases: "according to", "the website states", "documentation notes".
- NEVER state employee counts/headcount or name individuals or their roles/titles in the narrative sections.
- If information is not available, simply OMIT that topic and write about what IS available.
- Always produce substantive content based on what you CAN find.`;

/**
 * Assembles the user prompt for a section, including the full Vendors tab so the
 * critical-vendors and subservice sections work from the structured vendor list
 * rather than only the website scrape + Q&A.
 */
export function buildSectionUserPrompt({
  section,
  organization,
  websiteContent,
  contextHubText,
  vendorsBlock,
}: {
  section: Section;
  organization: { name: string; website: string };
  websiteContent: string;
  contextHubText: string;
  vendorsBlock: string;
}): string {
  return `${sectionPrompts[section]}

Company: ${organization.name}
Website: ${organization.website}

=== WEBSITE CONTENT ===
${websiteContent}

=== VENDORS TAB (every vendor the company has added) ===
${vendorsBlock}

=== ORGANIZATION CONTEXT ===
${contextHubText || 'No additional context.'}

=== END OF SOURCES ===

Generate the content based on the sources above. Write substantively about what you find - never mention missing information:`;
}

/** A single onboarding Q&A entry from the org's Context hub. */
export type ContextQA = { question: string; answer: string };

/**
 * Builds the org-context block concatenated into every section prompt. Excludes
 * three groups of Q&A:
 * 1. The auditor sections themselves — avoids feeding prior output back in.
 * 2. Framework selection — raw framework IDs, irrelevant to the content.
 * 3. Headcount + named-personnel answers (SENSITIVE_CONTEXT_QUESTIONS) —
 *    CS-589: these leak verbatim into the SOC 2 narrative fields otherwise.
 */
export function buildContextHubText(questionsAndAnswers: ContextQA[]): string {
  const excludedQuestions = new Set<string>([
    ...Object.values(SECTION_QUESTIONS),
    'Which compliance frameworks do you need?',
    ...SENSITIVE_CONTEXT_QUESTIONS,
  ]);

  return questionsAndAnswers
    .filter((qa) => !excludedQuestions.has(qa.question))
    .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
    .join('\n\n');
}
