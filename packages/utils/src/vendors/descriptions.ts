/**
 * Prompt-facing definitions of the classification vocabulary.
 *
 * Every AI step that classifies a vendor renders its guidance from here, so the
 * onboarding extractor, the discovery inference service, and the risk scorer
 * cannot drift apart in what they think a category means. Previously the enum was
 * injected into prompts with no explanation at all, which is how "SaaS" — a
 * delivery method — ended up being chosen as a business function.
 */

import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
  type DataFlowRoleValue,
  type DataServiceTypeValue,
  type VendorCategoryValue,
  type VendorDeliveryModelValue,
} from './classification';

export const VENDOR_CATEGORY_DESCRIPTIONS: Record<VendorCategoryValue, string> =
  {
    cloud_infrastructure:
      'Compute, storage, networking, databases, CDN, or hosting that our systems run on.',
    engineering_developer_tools:
      'Source control, CI/CD, package registries, error tracking, testing, IDEs.',
    security_compliance:
      'Security tooling and compliance services: scanning, pen testing, SIEM, GRC, audits.',
    identity_access_management:
      'Authentication, SSO, directory, secrets management, privileged access.',
    artificial_intelligence:
      'Model providers and AI platforms consumed for inference, training, or agents.',
    data_provider:
      'Sells datasets it already holds. We buy records that originate with them or their upstream sources.',
    data_enrichment:
      'Takes records we supply and returns them augmented with additional attributes.',
    data_collection:
      'Gathers new data on our behalf — crawling, scraping, surveys, tracking, monitoring.',
    automation_integration:
      'Connects other systems together: iPaaS, workflow automation, ETL/ELT pipelines, webhooks.',
    analytics_observability:
      'Product analytics, BI, dashboards, logging, metrics, tracing, uptime monitoring.',
    collaboration_productivity:
      'Messaging, email, documents, project management, scheduling, knowledge bases.',
    design_creative:
      'Design tooling, prototyping, asset libraries, video and image production.',
    finance:
      'Payments, billing, accounting, payroll, expenses, banking, tax, procurement.',
    marketing:
      'Campaigns, advertising, SEO, content, social, marketing automation, events.',
    sales: 'CRM, sales engagement, quoting, contracts, revenue operations.',
    hr_recruiting:
      'HRIS, applicant tracking, onboarding, benefits, performance, learning.',
    legal:
      'Legal counsel, contract lifecycle management, e-signature, IP and entity management.',
    customer_support:
      'Helpdesk, ticketing, live chat, community, customer success platforms.',
    other:
      'Use only when no other category fits. Never use it to avoid deciding.',
  };

export const VENDOR_DELIVERY_MODEL_DESCRIPTIONS: Record<
  VendorDeliveryModelValue,
  string
> = {
  saas: 'Multi-tenant hosted application we sign into. The default for most business tools.',
  cloud_service:
    'Cloud platform primitives we provision and configure, rather than a finished application.',
  api_service: 'Consumed programmatically over an API, with no end-user UI for us.',
  managed_service:
    'The vendor operates something on our behalf, including staffed or outsourced services.',
  desktop_application: 'Installed and run on employee workstations.',
  mobile_application: 'Installed and run on phones or tablets.',
  browser_extension: 'Runs inside the browser with access to page content.',
  open_source: 'Open-source software we self-host or vendor into our own systems.',
  internal_application: 'Built and operated by us; listed for dependency tracking.',
  other: 'Use only when no other delivery model fits.',
};

export const DATA_SERVICE_TYPE_DESCRIPTIONS: Record<
  DataServiceTypeValue,
  string
> = {
  people_data:
    'Data about individuals: identity, employment, demographics, behaviour.',
  company_data: 'Data about organisations: firmographics, hierarchy, technographics.',
  contact_data: 'Reachability details: email addresses, phone numbers, postal addresses.',
  web_data: 'Content harvested from websites, apps, or public pages.',
  financial_data: 'Transactions, balances, credit, funding, market or pricing data.',
  intent_data: 'Buying or engagement signals inferred from behaviour.',
  search: 'Query-time retrieval over an index the vendor maintains.',
  scraping: 'Automated extraction from sources the vendor does not own.',
  enrichment: 'Augments records we already hold with extra attributes.',
  verification: 'Confirms a record is valid, current, or belongs to who it claims.',
  matching: 'Resolves or links records to entities across datasets.',
  other: 'Use only when no other data service type fits.',
};

export const DATA_FLOW_ROLE_DESCRIPTIONS: Record<DataFlowRoleValue, string> = {
  source: 'Data originates with the vendor and flows into our systems.',
  processor: 'We send the vendor our data; it acts on it and returns or stores it.',
  destination: 'Our data flows to the vendor and comes to rest there.',
};

function renderList(
  values: readonly string[],
  descriptions: Record<string, string>,
): string {
  return values
    .map((value) => `- ${value}: ${descriptions[value]}`)
    .join('\n');
}

/**
 * The shared block of classification rules for any prompt that assigns these
 * dimensions. Rendered from the vocabulary so a new enum value shows up in every
 * prompt automatically.
 */
export function buildVendorClassificationGuidance(): string {
  return [
    'Classify each vendor along four INDEPENDENT dimensions. Do not let one decide another.',
    '',
    'The most common mistake is answering the category question with a delivery method.',
    '"SaaS" is not a business function — a hosted CRM is category `sales` with delivery model',
    '`saas`. Decide what the vendor DOES first, then separately how we consume it.',
    '',
    'category — exactly one, describing what the vendor does for us:',
    renderList(VENDOR_CATEGORIES, VENDOR_CATEGORY_DESCRIPTIONS),
    '',
    'deliveryModels — one or more, describing how we consume it:',
    renderList(VENDOR_DELIVERY_MODELS, VENDOR_DELIVERY_MODEL_DESCRIPTIONS),
    '',
    'dataServiceTypes — zero or more. Leave EMPTY unless the vendor supplies, enriches,',
    'or collects data as its product. A CRM that merely stores data we type in is not a',
    'data vendor.',
    renderList(DATA_SERVICE_TYPES, DATA_SERVICE_TYPE_DESCRIPTIONS),
    '',
    'dataFlowRoles — zero or more, describing where the vendor sits in our data flow.',
    'Leave EMPTY when no meaningful data crosses the boundary. A vendor can hold several',
    'roles: an enrichment provider is usually both `processor` and `source`.',
    renderList(DATA_FLOW_ROLES, DATA_FLOW_ROLE_DESCRIPTIONS),
    '',
    'Distinguishing the three data categories:',
    '- data_provider sells data it already has.',
    '- data_enrichment improves records we send it.',
    '- data_collection goes and gathers data that did not exist in collected form before.',
    'A vendor that does more than one takes the category matching its PRIMARY product, and',
    'records the rest through dataServiceTypes.',
  ].join('\n');
}
