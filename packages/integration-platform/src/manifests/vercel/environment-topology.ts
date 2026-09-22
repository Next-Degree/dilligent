import type { VercelProjectDetail } from './environments';
import type { VercelEnvironmentSeparation, VercelPreviewProtection } from './environment-analysis';
import type { VercelCustomEnvironment, VercelProject } from './types';

/**
 * Describing a Vercel project's environment topology for the report: which
 * branch becomes production, which branches land in each custom environment,
 * and how reachable the non-production ones are.
 *
 * Deliberately per ENVIRONMENT, never per branch — a project with a thousand
 * preview branches still has one preview environment, so the row count is
 * bounded by configuration rather than by activity.
 */

/** One row of a project's environment topology. */
export interface VercelEnvironmentRow {
  environment: string;
  type: string;
  /** Plain-language answer to "what lands here". */
  deploysFrom: string;
}

export interface VercelProjectTopology {
  productionBranch: string | null;
  gitRepository: string | null;
  environments: VercelEnvironmentRow[];
}

/**
 * The environment topology of a project as a short, readable list: which
 * branch becomes production, which branches land in each custom environment,
 * and the two built-ins that need no naming.
 *
 * This is the part an auditor reads in place of the console screenshot the
 * control asks for, which is why it is recorded for every project including
 * the ones that pass. It is deliberately per ENVIRONMENT, never per branch:
 * a project with a thousand preview branches still has one preview
 * environment, so the row count is bounded by configuration, not by activity.
 */
export function describeProjectTopology({
  project,
  customEnvironments,
}: {
  project: VercelProject;
  customEnvironments: readonly VercelCustomEnvironment[];
}): VercelProjectTopology {
  const productionBranch = project.link?.productionBranch ?? null;
  const environments: VercelEnvironmentRow[] = [
    {
      environment: 'production',
      type: 'production',
      deploysFrom: productionBranch
        ? `branch ${productionBranch}`
        : 'the production branch (not reported by Vercel for this project)',
    },
  ];

  for (const custom of customEnvironments) {
    environments.push({
      environment: custom.slug ?? custom.id ?? 'unnamed',
      type: custom.type ?? 'unknown',
      deploysFrom: describeBranchMatcher(custom.branchMatcher),
    });
  }

  environments.push(
    { environment: 'preview', type: 'preview', deploysFrom: 'every other branch' },
    { environment: 'development', type: 'development', deploysFrom: 'local development only' },
  );

  return { productionBranch, gitRepository: describeRepository(project.link), environments };
}

function describeBranchMatcher(matcher: VercelCustomEnvironment['branchMatcher']): string {
  if (!matcher?.pattern) return 'branches assigned in Vercel';
  const verb =
    matcher.type === 'startsWith'
      ? 'branches starting with'
      : matcher.type === 'endsWith'
        ? 'branches ending with'
        : 'branch';
  return `${verb} ${matcher.pattern}`;
}

function describeRepository(link: VercelProject['link']): string | null {
  if (!link?.repo) return null;
  return link.org ? `${link.org}/${link.repo}` : link.repo;
}

/**
 * Cap the environment rows carried per project in the team summary, so the
 * summary's evidence blob stays well under the 20,000-character limit the API
 * trims at — past that the whole blob is replaced with a placeholder and the
 * topology table, the most auditor-readable part of this check, disappears.
 */
const MAX_SUMMARY_ENVIRONMENT_ROWS = 10;

export function describeAccess({
  detail,
  protection,
}: {
  detail: VercelProjectDetail;
  protection: VercelPreviewProtection;
}): string {
  if (!detail.protectionKnown) return 'unknown';
  return protection.isProtected ? protection.methods.join(' or ') : 'unrestricted';
}

export function summaryRow({
  project,
  topology,
  protection,
  analysis,
  detail,
}: {
  project: VercelProject;
  topology: VercelProjectTopology;
  protection: VercelPreviewProtection;
  analysis: VercelEnvironmentSeparation;
  detail: VercelProjectDetail;
}) {
  return {
    project: project.name,
    repository: topology.gitRepository,
    productionBranch: topology.productionBranch,
    nonProductionEnvironments: topology.environments
      .filter((row) => row.type !== 'production')
      .slice(0, MAX_SUMMARY_ENVIRONMENT_ROWS)
      .map((row) => `${row.environment} (${row.deploysFrom})`),
    nonProductionAccess: describeAccess({ detail, protection }),
    sharedSecretCount: analysis.sharedSecretCount,
  };
}
