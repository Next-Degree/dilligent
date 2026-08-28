import type { TaskTemplateId } from '../../../task-mappings';
import type { CheckContext, FindingSeverity, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import type { ClassifiedVercelStore, VercelStoreClass } from '../stores';
import { fetchAllVercelStores, storeEvidence } from '../stores';
import { resolveVercelTeam } from '../team';

export interface StoreAttestationOptions {
  id: string;
  name: string;
  description: string;
  taskMapping: TaskTemplateId;
  /** Severity for a store whose posture Vercel cannot evidence. */
  defaultSeverity: FindingSeverity;
  /** Store classes this check covers. */
  classes: VercelStoreClass[];
  /** `resourceType` recorded on per-store results. */
  resourceType: string;
  /** `resourceId` for the run summary. */
  summaryResourceId: string;
  /** Plural noun used in titles and summaries, e.g. "Blob stores". */
  nounPlural: string;
  /** The property being attested, e.g. "Encryption at rest". */
  property: string;
  /** What Vercel guarantees for a store it runs itself. */
  guarantee: string;
  /** What the customer must obtain for a Marketplace store. */
  externalEvidence: string;
}

/** A store the check covers but whose engine class Vercel does not reveal. */
function reportUnclassifiedStores(
  ctx: CheckContext,
  options: StoreAttestationOptions,
  unclassified: ClassifiedVercelStore[],
  checkedAt: string,
): void {
  if (unclassified.length === 0) return;

  // Never let a classification gap read as "everything passed".
  ctx.fail({
    title: `${unclassified.length} store(s) could not be classified`,
    resourceType: 'vercel',
    resourceId: `${options.summaryResourceId}-unclassified`,
    severity: 'low',
    description: `Vercel reports ${unclassified.length} storage store(s) without enough detail to tell which engine backs them, so they were not evaluated by this check and their ${options.property.toLowerCase()} is unknown.`,
    remediation: `Review these stores in Vercel Dashboard > Storage and confirm ${options.property.toLowerCase()} directly with whoever operates them.`,
    evidence: {
      stores: unclassified.map(storeEvidence),
      checkedAt,
    },
  });
}

/**
 * Build a check that evidences one property (encryption at rest, TLS in
 * transit) across a class of Vercel storage stores.
 *
 * Vercel exposes no per-store toggle for either property on the stores it runs
 * — both are platform guarantees — so a store Vercel operates passes on its
 * inventory record. A Marketplace store is run by a third party that Vercel's
 * API says nothing about, so it is reported rather than assumed: attesting to
 * someone else's infrastructure from Vercel's inventory would look like a clean
 * result while evidencing nothing.
 */
export function createStoreAttestationCheck(
  options: StoreAttestationOptions,
  service: string,
): IntegrationCheck {
  const covered = new Set(options.classes);

  return {
    id: options.id,
    name: options.name,
    description: options.description,
    service,
    taskMapping: options.taskMapping,
    defaultSeverity: options.defaultSeverity,

    run: async (ctx: CheckContext) => {
      ctx.log(`Starting Vercel ${options.nounPlural.toLowerCase()} check: ${options.property}`);

      const team = await resolveVercelTeam(ctx);
      if (!team?.teamId) return;
      const { teamId, teamName } = team;
      const checkedAt = new Date().toISOString();

      let stores: ClassifiedVercelStore[];
      try {
        stores = await fetchAllVercelStores(ctx, teamId);
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: 'Failed to fetch Vercel storage stores',
          resourceType: 'vercel',
          resourceId: options.summaryResourceId,
          severity: 'high',
          description: `Could not list the team's storage stores, so no ${options.property.toLowerCase()} evidence could be collected: ${failure.error}`,
          remediation: remediationForReadFailure(
            failure,
            'Check that the Vercel access token was created by an account with Owner access to this team, then re-run the check.',
          ),
          evidence: { teamId, error: failure.error, denied: failure.denied, checkedAt },
        });
        return;
      }

      const inScope = stores.filter((store) => covered.has(store.storeClass));
      reportUnclassifiedStores(
        ctx,
        options,
        stores.filter((store) => store.storeClass === 'unknown'),
        checkedAt,
      );

      ctx.log(
        `Found ${inScope.length} ${options.nounPlural.toLowerCase()} of ${stores.length} storage store(s)`,
      );

      let attested = 0;
      for (const store of inScope) {
        const evidence = { ...storeEvidence(store), guarantee: options.guarantee, checkedAt };

        if (!store.isFirstParty) {
          const provider = store.provider ?? 'the Marketplace provider';
          ctx.fail({
            title: `${options.property} not verifiable: ${store.name}`,
            resourceType: options.resourceType,
            resourceId: store.id,
            severity: options.defaultSeverity,
            description: `${store.name} is a Vercel Marketplace store operated by ${provider}, not by Vercel. Vercel's API reports nothing about how ${provider} protects the data, so ${options.property.toLowerCase()} cannot be evidenced from this connection.`,
            remediation: `${options.externalEvidence} Obtain it from ${provider} — their security documentation or compliance report — and attach it to this task.`,
            evidence,
          });
          continue;
        }

        if (!store.healthy) {
          ctx.fail({
            title: `${options.property} unconfirmed: ${store.name}`,
            resourceType: options.resourceType,
            resourceId: store.id,
            severity: 'low',
            description: `Vercel reports ${store.name} as "${store.status}" rather than available, so its current configuration could not be read and ${options.property.toLowerCase()} is unconfirmed.`,
            remediation: `Open Vercel Dashboard > Storage > ${store.name}, restore it to an available state or delete it if it is no longer needed, then re-run the check.`,
            evidence,
          });
          continue;
        }

        attested++;
        ctx.pass({
          title: `${options.property} confirmed: ${store.name}`,
          resourceType: options.resourceType,
          resourceId: store.id,
          description: `${store.name} is a ${store.type} store run by Vercel. ${options.guarantee}`,
          evidence,
        });
      }

      ctx.pass({
        title: `Vercel ${options.nounPlural} — ${options.property}`,
        resourceType: 'vercel',
        resourceId: options.summaryResourceId,
        description:
          inScope.length === 0
            ? `This Vercel team has no ${options.nounPlural.toLowerCase()}, so there is nothing holding data of this kind.`
            : `${attested} of ${inScope.length} ${options.nounPlural.toLowerCase()} are run by Vercel and covered by its platform guarantee.`,
        evidence: {
          teamId,
          teamName: teamName ?? null,
          totalStores: stores.length,
          inScopeStores: inScope.length,
          attestedStores: attested,
          guarantee: options.guarantee,
          stores: inScope.map(storeEvidence),
          checkedAt,
        },
      });

      ctx.log(
        `Vercel ${options.property.toLowerCase()} check complete: ${attested}/${inScope.length} ${options.nounPlural.toLowerCase()} attested`,
      );
    },
  };
}
