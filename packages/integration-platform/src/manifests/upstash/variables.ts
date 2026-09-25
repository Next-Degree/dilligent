import type { CheckVariable, CheckVariableValues } from '../../types';
import { listUpstashDatabases } from './client';
import type { UpstashDatabase } from './types';

export type UpstashDatabaseFilterMode = 'all' | 'include' | 'exclude';

export interface UpstashDatabaseFilter {
  mode: UpstashDatabaseFilterMode;
  selectedIds: Set<string>;
}

const VALID_MODES: ReadonlySet<string> = new Set<UpstashDatabaseFilterMode>([
  'all',
  'include',
  'exclude',
]);

export function parseUpstashDatabaseFilter(
  variables: CheckVariableValues | undefined,
): UpstashDatabaseFilter {
  const rawMode = variables?.database_filter_mode;
  const mode: UpstashDatabaseFilterMode =
    typeof rawMode === 'string' && VALID_MODES.has(rawMode)
      ? (rawMode as UpstashDatabaseFilterMode)
      : 'all';

  const rawSelected = variables?.filtered_databases;
  const selectedIds = new Set<string>(
    Array.isArray(rawSelected) ? rawSelected.filter((v): v is string => typeof v === 'string') : [],
  );

  return { mode, selectedIds };
}

export function applyUpstashDatabaseFilter<T extends Pick<UpstashDatabase, 'database_id'>>(
  databases: T[],
  filter: UpstashDatabaseFilter,
): T[] {
  if (filter.mode === 'all' || filter.selectedIds.size === 0) return databases;
  if (filter.mode === 'include') {
    return databases.filter((db) => filter.selectedIds.has(db.database_id));
  }
  return databases.filter((db) => !filter.selectedIds.has(db.database_id));
}

export const databaseFilterModeVariable: CheckVariable = {
  id: 'database_filter_mode',
  label: 'Databases to check',
  helpText:
    'Choose which Upstash databases this automation checks. Pick "Only selected" or "Exclude selected" to narrow the scope.',
  type: 'select',
  required: false,
  default: 'all',
  options: [
    { value: 'all', label: 'All databases' },
    { value: 'include', label: 'Only selected databases' },
    { value: 'exclude', label: 'Exclude selected databases' },
  ],
};

export const filteredDatabasesVariable: CheckVariable = {
  id: 'filtered_databases',
  label: 'Databases',
  helpText:
    'Select databases to include or exclude based on the mode above. Ignored when mode is "All databases".',
  type: 'multi-select',
  required: false,
  placeholder: 'Select databases…',
  fetchOptions: async (ctx) => {
    // Shares `client.ts`'s listing so the picker and the checks can never
    // disagree about which databases exist.
    const databases = await listUpstashDatabases(ctx);
    return databases
      .map((db) => ({ value: db.database_id, label: db.database_name ?? db.database_id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },
};

export const databaseScopeVariables: CheckVariable[] = [
  databaseFilterModeVariable,
  filteredDatabasesVariable,
];
