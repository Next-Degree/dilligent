import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import type { ClassifiedVercelStore } from '../stores';
import { fetchAllVercelStores, storeEvidence } from '../stores';
import { resolveVercelTeam } from '../team';

const SUMMARY_RESOURCE_ID = 'bucket-access';

/**
 * A Vercel Blob store is created with `access` set to `public` or `private`.
 * Objects in a public store are served to anyone holding the URL; a private
 * store requires a token on every read.
 */
type BucketAccess = 'public' | 'private' | 'unknown';

function readAccess(store: ClassifiedVercelStore): BucketAccess {
  const access = store.store.access;
  if (access === 'public' || access === 'private') return access;
  return 'unknown';
}

/**
 * Vercel storage bucket secure access enabled
 *
 * Requires every Vercel Blob store to be private, so reading an object needs a
 * token rather than only its URL. A store Vercel does not report an access
 * model for is reported as unknown rather than passed — a bucket that predates
 * the private option is exactly the one worth looking at.
 *
 * Maps to: Secure Storage
 */
export const storageBucketSecureAccessCheck: IntegrationCheck = {
  id: 'storage-bucket-secure-access',
  name: 'Vercel storage bucket secure access enabled',
  description:
    'Verify Vercel Blob stores require a token to read objects rather than serving them publicly',
  service: 'storage',
  taskMapping: TASK_TEMPLATES.secureStorage,
  defaultSeverity: 'high',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel storage bucket access check');

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
        resourceId: SUMMARY_RESOURCE_ID,
        severity: 'high',
        description: `Could not list the team's storage stores, so no bucket access evidence could be collected: ${failure.error}`,
        remediation: remediationForReadFailure(
          failure,
          'Check that the Vercel access token was created by an account with Owner access to this team, then re-run the check.',
        ),
        evidence: { teamId, error: failure.error, denied: failure.denied, checkedAt },
      });
      return;
    }

    const buckets = stores.filter((store) => store.storeClass === 'blob');
    ctx.log(`Checking access on ${buckets.length} bucket(s) of ${stores.length} storage store(s)`);

    let privateCount = 0;
    for (const bucket of buckets) {
      const access = readAccess(bucket);
      const evidence = { ...storeEvidence(bucket), access, checkedAt };

      if (!bucket.isFirstParty) {
        const provider = bucket.provider ?? 'the Marketplace provider';
        ctx.fail({
          title: `Bucket access model not verifiable: ${bucket.name}`,
          resourceType: 'blob-store',
          resourceId: bucket.id,
          severity: 'medium',
          description: `${bucket.name} is a Vercel Marketplace store operated by ${provider}. Vercel's API does not report who can read its objects, so secure access cannot be evidenced from this connection.`,
          remediation: `Review the bucket's access policy with ${provider} and attach their configuration or attestation to this task.`,
          evidence,
        });
        continue;
      }

      if (access === 'private') {
        privateCount++;
        ctx.pass({
          title: `Bucket access restricted: ${bucket.name}`,
          resourceType: 'blob-store',
          resourceId: bucket.id,
          description: `${bucket.name} is a private Blob store, so every read is authorized with a token rather than served to anyone holding the object URL.`,
          evidence,
        });
        continue;
      }

      if (access === 'public') {
        ctx.fail({
          title: `Bucket serves objects publicly: ${bucket.name}`,
          resourceType: 'blob-store',
          resourceId: bucket.id,
          severity: 'high',
          description: `${bucket.name} is a public Blob store: anyone with an object's URL can read it, and Blob URLs contain an unguessable suffix but are not access-controlled. Anything uploaded here is readable by anyone the URL reaches.`,
          remediation: `If this bucket holds anything that is not intended to be public, create a private store in Vercel Dashboard > Storage, migrate the objects to it, and upload with access: 'private'. A store's access model is fixed when it is created and cannot be changed in place.`,
          evidence,
        });
        continue;
      }

      ctx.fail({
        title: `Bucket access model unknown: ${bucket.name}`,
        resourceType: 'blob-store',
        resourceId: bucket.id,
        severity: 'medium',
        description: `Vercel returned no access model for ${bucket.name}. Blob stores created before private stores existed are public, so an unreported access model is more likely to be public than private.`,
        remediation: `Open Vercel Dashboard > Storage > ${bucket.name} and confirm whether it serves objects publicly; move anything sensitive to a private store.`,
        evidence,
      });
    }

    ctx.pass({
      title: 'Vercel storage bucket access',
      resourceType: 'vercel',
      resourceId: SUMMARY_RESOURCE_ID,
      description:
        buckets.length === 0
          ? 'This Vercel team has no Blob stores, so there are no buckets serving objects.'
          : `${privateCount} of ${buckets.length} bucket(s) require a token to read objects.`,
      evidence: {
        teamId,
        teamName: teamName ?? null,
        totalStores: stores.length,
        bucketCount: buckets.length,
        privateBucketCount: privateCount,
        buckets: buckets.map((bucket) => ({
          ...storeEvidence(bucket),
          access: readAccess(bucket),
        })),
        checkedAt,
      },
    });

    ctx.log(
      `Vercel bucket access check complete: ${privateCount}/${buckets.length} bucket(s) private`,
    );
  },
};
