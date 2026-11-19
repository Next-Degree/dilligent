/**
 * Fold a freshly saved completion into the list the portal already holds.
 *
 * A member can have several rows for the same module, one per yearly renewal
 * cycle, so a row is only replaced by one for the same module AND cycle.
 * Matching on the module alone would overwrite last year's row with the
 * renewal and make the member look as if they had never finished the training.
 */
export function mergeCompletion<T extends { videoId: string; cycle: number }>({
  current,
  updated,
}: {
  current: readonly T[] | undefined;
  updated: T;
}): T[] {
  if (!current) return [updated];

  const isSameRow = (row: T) => row.videoId === updated.videoId && row.cycle === updated.cycle;

  return current.some(isSameRow)
    ? current.map((row) => (isSameRow(row) ? updated : row))
    : [...current, updated];
}
