import type { CheckVariable, CheckVariableValues } from '../../types';
import type { NeonOrganizationsResponse, NeonProject, NeonProjectsResponse } from './types';

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

/** Neon's plan ceiling for the point-in-time restore window is 30 days. */
export const MAX_HISTORY_RETENTION_DAYS = 30;
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
    // A personal API key only sees an organization's projects when `org_id` is
    // passed, so the organizations are enumerated first and each is paged
    // alongside the un-scoped listing. An org-scoped key answers 401/403 on the
    // user route and infers its org on the un-scoped listing, so it still lands
    // on the same set.
    const seen = new Map<string, string>();
    const PAGE_SIZE = 100;
    const MAX_PAGES = 20;

    let orgIds: string[] = [];
    try {
      const response = await ctx.fetch<NeonOrganizationsResponse>('users/me/organizations');
      orgIds = (response.organizations ?? []).map((org) => org.id);
    } catch {
      orgIds = [];
    }

    for (const scope of [undefined, ...orgIds]) {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (scope) params.set('org_id', scope);
        if (cursor) params.set('cursor', cursor);

        const response = await ctx.fetch<NeonProjectsResponse>(`projects?${params.toString()}`);
        const projects = response.projects ?? [];
        for (const project of projects) {
          if (!seen.has(project.id)) seen.set(project.id, project.name ?? project.id);
        }

        const next = response.pagination?.cursor;
        if (projects.length < PAGE_SIZE || !next || next === cursor) break;
        cursor = next;
      }
    }

    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
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
  helpText: `Retention window each project must meet. Neon's restore history tops out at ${MAX_HISTORY_RETENTION_DAYS} days on the Scale plan; snapshot retention can go higher.`,
};

export const projectScopeVariables: CheckVariable[] = [
  projectFilterModeVariable,
  filteredProjectsVariable,
];
