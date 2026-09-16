import type { CheckVariable, CheckVariableValues } from '../../types';
import { fetchAllNeonProjects, listNeonOrganizations } from './client';
import type { NeonProject } from './types';

export type NeonProjectFilterMode = 'all' | 'include' | 'exclude';

export interface NeonProjectFilter {
  mode: NeonProjectFilterMode;
  selectedIds: Set<string>;
}

const VALID_MODES: ReadonlySet<string> = new Set<NeonProjectFilterMode>([
  'all',
  'include',
  'exclude',
]);

export const SECONDS_PER_DAY = 86_400;

/**
 * Seconds to days at one decimal, for evidence. Shared so two checks reporting
 * retention for the same underlying seconds cannot print different figures.
 */
export const toDays = (seconds: number | null | undefined): number | null =>
  typeof seconds === 'number' && Number.isFinite(seconds)
    ? Math.round((seconds / SECONDS_PER_DAY) * 10) / 10
    : null;

/** Neon's plan ceiling for the point-in-time restore window is 30 days. */
export const MAX_HISTORY_RETENTION_DAYS = 30;
/**
 * Ceiling on a backup schedule's `retention_seconds` (3,024,000s), per the API
 * reference. Nothing Neon exposes retains recoverable history longer, so a
 * threshold above this is unsatisfiable by any configuration change.
 */
export const MAX_SNAPSHOT_RETENTION_DAYS = 35;
export const DEFAULT_RETENTION_DAYS = 28;

export function parseNeonProjectFilter(
  variables: CheckVariableValues | undefined,
): NeonProjectFilter {
  const rawMode = variables?.project_filter_mode;
  const mode: NeonProjectFilterMode =
    typeof rawMode === 'string' && VALID_MODES.has(rawMode)
      ? (rawMode as NeonProjectFilterMode)
      : 'all';

  const rawSelected = variables?.filtered_projects;
  const selectedIds = new Set<string>(
    Array.isArray(rawSelected) ? rawSelected.filter((v): v is string => typeof v === 'string') : [],
  );

  return { mode, selectedIds };
}

export function applyNeonProjectFilter<T extends Pick<NeonProject, 'id'>>(
  projects: T[],
  filter: NeonProjectFilter,
): T[] {
  if (filter.mode === 'all' || filter.selectedIds.size === 0) return projects;
  if (filter.mode === 'include') return projects.filter((p) => filter.selectedIds.has(p.id));
  return projects.filter((p) => !filter.selectedIds.has(p.id));
}

/**
 * Minimum retention the log-retention check requires, in days. Parsed
 * defensively: the value arrives from a text input, so a blank or unparseable
 * entry must fall back to the default rather than silently becoming `NaN`,
 * which would compare false against every real window and fail every project.
 */
export function parseRetentionDays(variables: CheckVariableValues | undefined): number {
  const raw = variables?.minimum_retention_days;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETENTION_DAYS;
  return Math.floor(parsed);
}

export const projectFilterModeVariable: CheckVariable = {
  id: 'project_filter_mode',
  label: 'Projects to check',
  helpText:
    'Choose which Neon projects this automation checks. Pick "Only selected" or "Exclude selected" to narrow the scope.',
  type: 'select',
  required: false,
  default: 'all',
  options: [
    { value: 'all', label: 'All projects' },
    { value: 'include', label: 'Only selected projects' },
    { value: 'exclude', label: 'Exclude selected projects' },
  ],
};

export const filteredProjectsVariable: CheckVariable = {
  id: 'filtered_projects',
  label: 'Projects',
  helpText:
    'Select projects to include or exclude based on the mode above. Ignored when mode is "All projects".',
  type: 'multi-select',
  required: false,
  placeholder: 'Select projects…',
  fetchOptions: async (ctx) => {
    // Shares `client.ts`'s listing so the picker and the checks can never
    // disagree about which projects exist. `VariableFetchContext` satisfies
    // `NeonFetcher` (it has no `warn`, which is why that is optional).
    const organizations = await listNeonOrganizations(ctx);
    const { projects } = await fetchAllNeonProjects(ctx, organizations);

    return projects
      .map((project) => ({ value: project.id, label: project.name ?? project.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },
};

export const minimumRetentionDaysVariable: CheckVariable = {
  id: 'minimum_retention_days',
  label: 'Minimum retention (days)',
  type: 'number',
  required: false,
  default: String(DEFAULT_RETENTION_DAYS),
  placeholder: String(DEFAULT_RETENTION_DAYS),
  helpText: `Retention window each project must meet. Neon's restore history tops out at ${MAX_HISTORY_RETENTION_DAYS} days on the Scale plan, and scheduled snapshots at ${MAX_SNAPSHOT_RETENTION_DAYS} days — a value above ${MAX_SNAPSHOT_RETENTION_DAYS} cannot be met by any Neon setting.`,
};

export const projectScopeVariables: CheckVariable[] = [
  projectFilterModeVariable,
  filteredProjectsVariable,
];
