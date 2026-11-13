/**
 * Shared fixtures for the training specs.
 *
 * Named `*-spec.ts` on purpose: `tsconfig.build.json` excludes `**\/*spec.ts`,
 * so this stays out of the production build, while Jest only runs
 * `*.spec.ts`, so it is not collected as a suite.
 */

export const GENERAL = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'];

const DAY_MS = 24 * 60 * 60 * 1000;

export const daysAgo = (days: number): Date =>
  new Date(Date.now() - days * DAY_MS);

export interface CompletionRow {
  id: string;
  memberId: string;
  videoId: string;
  cycle: number;
  dueAt: Date | null;
  completedAt: Date | null;
}

export const row = ({
  videoId,
  cycle = 1,
  days,
}: {
  videoId: string;
  cycle?: number;
  days: number | null;
}): CompletionRow => ({
  id: `evc_${videoId}_${cycle}`,
  memberId: 'mem_1',
  videoId,
  cycle,
  dueAt: null,
  completedAt: days === null ? null : daysAgo(days),
});

export const rowsFor = ({
  videoIds,
  cycle = 1,
  days,
}: {
  videoIds: string[];
  cycle?: number;
  days: number;
}): CompletionRow[] => videoIds.map((videoId) => row({ videoId, cycle, days }));

/**
 * A tiny in-memory stand-in for the completion table, so multi step flows
 * read back what they wrote. Assign `rows` to seed it.
 */
export function createCompletionTable() {
  const table = {
    rows: [] as CompletionRow[],
    findMany: async () => table.rows,
    upsert: async ({
      create,
    }: {
      create: Omit<CompletionRow, 'id' | 'dueAt'>;
    }) => {
      const existing = table.rows.find(
        (r) => r.videoId === create.videoId && r.cycle === create.cycle,
      );
      if (existing) return existing;

      const created: CompletionRow = {
        id: `evc_${create.videoId}_${create.cycle}`,
        dueAt: null,
        ...create,
      };
      table.rows.push(created);
      return created;
    },
  };
  return table;
}
