import { z } from 'zod';

// `nullable` is checked before coercion, so a missing date stays null instead
// of becoming the start of 1970.
const dateOrNull = z.coerce.date().nullable();

const completionSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  videoId: z.string(),
  cycle: z.number().int(),
  completedAt: dateOrNull,
  dueAt: dateOrNull.default(null),
});

export type ParsedCompletion = z.infer<typeof completionSchema>;

/**
 * Training completions arriving over JSON carry their dates as strings. The
 * training status logic compares and does arithmetic on them, so every row is
 * turned back into real dates here, at the boundary, rather than trusted.
 */
export function parseCompletions(json: unknown): ParsedCompletion[] {
  return z.array(completionSchema).parse(json);
}

export function parseCompletion(json: unknown): ParsedCompletion {
  return completionSchema.parse(json);
}
