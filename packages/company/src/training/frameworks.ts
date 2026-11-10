/** Framework an organization must have enabled to be offered HIPAA training. */
export const HIPAA_FRAMEWORK_NAME = 'HIPAA';

/** Framework an organization must have enabled to be offered CCPA training. */
export const CCPA_FRAMEWORK_NAME = 'CCPA';

/** Shared rejection copy so both paths fail identically for ineligible orgs. */
export const HIPAA_TRAINING_UNAVAILABLE_MESSAGE =
  'HIPAA training is not available for this organization';

export const CCPA_TRAINING_UNAVAILABLE_MESSAGE =
  'CCPA training is not available for this organization';

/**
 * Prisma `where` fragment identifying an org's instance of a named framework.
 *
 * Returned as plain data rather than running the query here, so this package
 * stays free of a Prisma client — the API and the portal each hold their own.
 */
export function frameworkInstanceWhere({
  organizationId,
  frameworkName,
}: {
  organizationId: string;
  frameworkName: string;
}) {
  return {
    organizationId,
    framework: { name: frameworkName },
  };
}

export function hipaaFrameworkInstanceWhere(organizationId: string) {
  return frameworkInstanceWhere({ organizationId, frameworkName: HIPAA_FRAMEWORK_NAME });
}

export function ccpaFrameworkInstanceWhere(organizationId: string) {
  return frameworkInstanceWhere({ organizationId, frameworkName: CCPA_FRAMEWORK_NAME });
}
