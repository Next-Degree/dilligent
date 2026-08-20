import { Injectable, Logger } from '@nestjs/common';
import { anthropic } from '@ai-sdk/anthropic';
import { db, DiscoveredVendorStatus, VendorResolutionMethod } from '@db';
import { generateObject } from 'ai';
import { z } from 'zod';
import { INFERENCE_CONFIDENCE_CEILING } from './vendor-resolution.service';

const MODEL = anthropic('claude-sonnet-4-6');

/**
 * Names per request. Batched because these are one-line lookups — a call per candidate would
 * multiply latency and cost for no better answer.
 */
export const INFERENCE_BATCH_SIZE = 25;

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      /** Echoed back so results can be matched to inputs without relying on array order. */
      displayName: z.string(),
      recognized: z.boolean(),
      vendorName: z.string().nullable(),
      website: z.string().nullable(),
      description: z.string().nullable(),
      category: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const SYSTEM_PROMPT = `You identify software vendors from the display names of OAuth
applications that employees have signed into with their work Google account.

For each name, say whether you recognize it as a real, publicly known software product or
company. Set recognized to false when you do not — a guess is worse than an admission,
because a wrong vendor name ends up in a compliance register.

Never invent a website. Only give one you are confident is the vendor's real primary domain.
Keep descriptions to one factual sentence about what the product does.`;

interface InferenceCandidate {
  id: string;
  displayName: string;
}

@Injectable()
export class VendorInferenceService {
  private readonly logger = new Logger(VendorInferenceService.name);

  /**
   * Suggest vendor identities for candidates that survived every deterministic tier.
   *
   * The result is always a suggestion: candidates stay pending, confidence is capped below
   * certainty, and nothing is auto-approved. Inference exists to save a reviewer typing, not
   * to make the decision.
   *
   * Deliberately does no web research inline — deep research already runs on approval, and
   * it is globally serialised, so pulling it in here would make one organization's discovery
   * queue block every other organization's vendor assessments.
   */
  async inferPending({ organizationId }: { organizationId: string }): Promise<{
    attempted: number;
    recognized: number;
  }> {
    const candidates = await this.loadCandidatesNeedingInference(organizationId);
    if (candidates.length === 0) {
      return { attempted: 0, recognized: 0 };
    }

    let recognized = 0;

    for (let i = 0; i < candidates.length; i += INFERENCE_BATCH_SIZE) {
      const batch = candidates.slice(i, i + INFERENCE_BATCH_SIZE);
      recognized += await this.inferBatch(batch);
    }

    return { attempted: candidates.length, recognized };
  }

  /**
   * Candidates are re-inferred only when their display name changes, which is the one thing
   * that can change the answer. `inferenceDisplayName` records what was last submitted.
   */
  private async loadCandidatesNeedingInference(
    organizationId: string,
  ): Promise<InferenceCandidate[]> {
    const rows = await db.discoveredVendorCandidate.findMany({
      where: {
        organizationId,
        status: DiscoveredVendorStatus.pending,
        resolutionMethod: VendorResolutionMethod.unresolved,
        displayName: { not: null },
      },
      select: { id: true, displayName: true, inferenceDisplayName: true },
    });

    return rows
      .filter((row) => row.displayName !== row.inferenceDisplayName)
      .map((row) => ({ id: row.id, displayName: row.displayName as string }));
  }

  private async inferBatch(batch: InferenceCandidate[]): Promise<number> {
    let object: z.infer<typeof suggestionSchema>;

    try {
      const result = await generateObject({
        model: MODEL,
        schema: suggestionSchema,
        system: SYSTEM_PROMPT,
        prompt: `Identify these OAuth application names:\n${batch
          .map((candidate) => `- ${candidate.displayName}`)
          .join('\n')}`,
      });
      object = result.object;
    } catch (error) {
      // A failed batch is not a failed run — the candidates simply stay unresolved and are
      // retried next time, since their display name has not been recorded as submitted.
      this.logger.warn(`Vendor inference batch failed: ${String(error)}`);
      return 0;
    }

    const byName = new Map(
      object.suggestions.map((suggestion) => [suggestion.displayName, suggestion]),
    );

    let recognized = 0;

    for (const candidate of batch) {
      const suggestion = byName.get(candidate.displayName);

      // Record the attempt either way, so an unrecognised name is not resubmitted forever.
      if (!suggestion || !suggestion.recognized) {
        await db.discoveredVendorCandidate.update({
          where: { id: candidate.id },
          data: {
            inferenceAttemptedAt: new Date(),
            inferenceDisplayName: candidate.displayName,
            inferenceRawOutput: suggestion ? { ...suggestion } : undefined,
          },
        });
        continue;
      }

      recognized++;
      await db.discoveredVendorCandidate.update({
        where: { id: candidate.id },
        data: {
          resolutionMethod: VendorResolutionMethod.inferred,
          resolvedName: suggestion.vendorName,
          resolvedWebsite: suggestion.website,
          resolvedDescription: suggestion.description,
          // Capped so an inferred result can never read as more certain than a
          // deterministic one, and never as certain enough to act on unattended.
          confidence: Math.min(suggestion.confidence, INFERENCE_CONFIDENCE_CEILING),
          inferenceAttemptedAt: new Date(),
          inferenceDisplayName: candidate.displayName,
          // Raw output retained as evidence for anyone auditing why this was suggested.
          inferenceRawOutput: { ...suggestion },
          // Status is deliberately untouched: inference never decides.
        },
      });
    }

    return recognized;
  }
}
