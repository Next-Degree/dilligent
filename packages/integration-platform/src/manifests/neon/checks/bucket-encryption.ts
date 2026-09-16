import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import { API_VERIFIED, NEON_ATTESTATION, attestationEvidence, attestedClaim } from '../attestation';
import {
  fetchNeonBranchStorage,
  listNeonBranchBuckets,
  listNeonBranches,
  pickDefaultBranch,
} from '../client';
import { limitProjects, projectEvidence, resolveNeonScope } from '../scope';
import type { NeonBranch, NeonBucket } from '../types';
import { projectScopeVariables } from '../variables';

/**
 * 404 reasons that mean "this feature is not turned on here", as opposed to
 * "you can no longer see this branch". The first three are states of the
 * product; only `branch_not_found` implies the key may have lost access, which
 * has to read as unknown rather than as a clean not-applicable.
 */
const NOT_ENTITLED_REASONS: ReadonlySet<string> = new Set([
  'org_not_entitled',
  'region_unavailable',
  'branch_directory_missing',
  'not_enabled',
]);

/**
 * Any level naming "public" exposes objects without credentials. Matched on a
 * substring rather than an exact `public_read` so a future level such as
 * `public_read_write` is caught instead of silently passing.
 */
const isPubliclyReadable = (bucket: NeonBucket): boolean =>
  typeof bucket.access_level === 'string' && bucket.access_level.toLowerCase().includes('public');

const describeBucket = (bucket: NeonBucket) => ({
  bucketName: bucket.name,
  accessLevel: bucket.access_level ?? null,
  createdAt: bucket.created_at ?? null,
});

const branchEvidence = (branch: NeonBranch) => ({
  branchId: branch.id,
  branchName: branch.name ?? null,
});

/**
 * Neon Bucket Encrypted
 *
 * Neon buckets are branchable object storage the customer creates and names.
 * This check reads the ones visible on each project's default branch — which
 * includes buckets inherited from ancestor branches, so the default branch
 * carries the canonical set — and evidences encryption at rest against those
 * named buckets rather than against the platform in the abstract.
 *
 * Encryption itself has no per-bucket switch, so that half stays
 * provider-attested. `access_level` does vary per bucket, and a `public_read`
 * bucket serves its objects without credentials however well they are
 * encrypted at rest, so every bucket in the listing is judged — the endpoint
 * returns them all in one response, so there is nothing to gain by sampling.
 *
 * Maps to: Secure Storage
 */
export const bucketEncryptionCheck: IntegrationCheck = {
  id: 'bucket-encrypted',
  name: 'Bucket Encrypted',
  description:
    'Verify Neon object storage buckets are encrypted at rest and none are publicly readable',
  service: 'security',
  taskMapping: TASK_TEMPLATES.secureStorage,
  defaultSeverity: 'high',
  variables: projectScopeVariables,

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Neon bucket encryption check');

    const scope = await resolveNeonScope(ctx);
    if (!scope) return;

    const attestation = attestationEvidence(NEON_ATTESTATION.objectStorage);
    const projects = limitProjects(ctx, scope);
    let bucketCount = 0;
    let publicCount = 0;
    let storageEnabledCount = 0;

    for (const project of projects) {
      const name = project.name ?? project.id;
      const base = { ...projectEvidence(project), checkedAt: scope.checkedAt };

      // Every "we could not establish this" outcome shares one envelope; only
      // the wording and the extra evidence differ. Spelling it once also keeps
      // `denied` on every read failure, which three separate copies did not.
      const unknown = (
        description: string,
        remediation: string,
        evidence: Record<string, unknown>,
      ) =>
        ctx.fail({
          title: `Bucket encryption unknown: ${name}`,
          description,
          resourceType: 'neon_project',
          resourceId: project.id,
          severity: 'medium',
          remediation,
          evidence: { ...base, ...evidence },
        });

      const unknownFromRead = (
        error: unknown,
        description: (reason: string) => string,
        fallback: string,
        evidence: Record<string, unknown> = {},
      ) => {
        const failure = toHttpReadFailure(error);
        unknown(description(failure.error), remediationForReadFailure(failure, fallback), {
          ...evidence,
          error: failure.error,
          denied: failure.denied,
        });
      };

      let branches: NeonBranch[];
      try {
        branches = await listNeonBranches(ctx, project.id);
      } catch (error) {
        unknownFromRead(
          error,
          (reason) => `Could not list branches for this project: ${reason}`,
          'Confirm the Neon API key still has access to this project, then re-run the check.',
        );
        continue;
      }

      const branch = pickDefaultBranch(branches);
      if (!branch) {
        unknown(
          branches.length > 0
            ? `Neon flagged no default branch among ${branches.length} branch(es) for "${name}", so there is no canonical branch whose buckets speak for the project.`
            : `Neon project "${name}" has no branches, so its buckets cannot be listed.`,
          branches.length > 0
            ? "Set the project's default branch in Neon Console > Branches, then re-run the check."
            : 'Confirm this project is still in use; delete it if it is not.',
          { branchCount: branches.length },
        );
        continue;
      }

      let reason: string | null;
      try {
        reason = await fetchNeonBranchStorage(ctx, project.id, branch.id);
      } catch (error) {
        unknownFromRead(
          error,
          (why) =>
            `Could not read object storage state for branch "${branch.name ?? branch.id}": ${why}`,
          'Confirm the Neon API key still has access to this project, then re-run the check.',
          branchEvidence(branch),
        );
        continue;
      }

      if (reason && !NOT_ENTITLED_REASONS.has(reason)) {
        // `branch_not_found` lands here: the branch was listed a moment ago, so
        // its disappearance is a read problem, not a disabled feature.
        unknown(
          `Neon reported object storage unavailable for branch "${branch.name ?? branch.id}" with reason "${reason}".`,
          'Confirm the Neon API key still has access to this project and branch, then re-run the check.',
          { ...branchEvidence(branch), storageReason: reason },
        );
        continue;
      }

      if (reason) {
        // Feature genuinely off for this branch. There are no buckets to
        // encrypt, so this passes — with the reason on the record, not silently.
        ctx.pass({
          title: `No object storage in use: ${name}`,
          description: `Branchable object storage is not enabled for "${name}" (${reason}), so the project holds no buckets.`,
          resourceType: 'neon_project',
          resourceId: project.id,
          evidence: {
            ...base,
            ...branchEvidence(branch),
            objectStorageEnabled: false,
            storageReason: reason,
            bucketCount: 0,
          },
        });
        continue;
      }

      storageEnabledCount++;

      let buckets: NeonBucket[];
      try {
        buckets = await listNeonBranchBuckets(ctx, project.id, branch.id);
      } catch (error) {
        unknownFromRead(
          error,
          (why) =>
            `Object storage is enabled for "${name}" but its buckets could not be listed: ${why}`,
          'Confirm the Neon API key can read buckets on this branch, then re-run the check.',
          branchEvidence(branch),
        );
        continue;
      }

      if (buckets.length === 0) {
        ctx.pass({
          title: `No buckets to encrypt: ${name}`,
          description: `Object storage is enabled for "${name}" but the default branch holds no buckets.`,
          resourceType: 'neon_project',
          resourceId: project.id,
          evidence: {
            ...base,
            ...branchEvidence(branch),
            objectStorageEnabled: true,
            bucketCount: 0,
          },
        });
        continue;
      }

      for (const bucket of buckets) {
        bucketCount++;
        const bucketEvidence = {
          ...base,
          ...branchEvidence(branch),
          ...describeBucket(bucket),
        };

        ctx.pass({
          title: `Bucket encrypted: ${bucket.name}`,
          description: attestedClaim(
            NEON_ATTESTATION.objectStorage,
            `bucket "${bucket.name}" on branch "${branch.name ?? branch.id}" of project "${name}"`,
          ),
          resourceType: 'neon_bucket',
          resourceId: `${project.id}/${bucket.name}`,
          evidence: { ...attestation, ...bucketEvidence },
        });

        if (isPubliclyReadable(bucket)) {
          publicCount++;
          ctx.fail({
            title: `Bucket is publicly readable: ${bucket.name}`,
            description: `Bucket "${bucket.name}" on project "${name}" has access level "${bucket.access_level}", so its objects can be read without credentials regardless of encryption at rest.`,
            resourceType: 'neon_bucket',
            resourceId: `${project.id}/${bucket.name}`,
            severity: 'high',
            remediation: `Set bucket "${bucket.name}" to private in Neon Console > Storage, or confirm in writing that every object it holds is intended to be public.`,
            evidence: { verification: API_VERIFIED, ...bucketEvidence },
          });
        }
      }
    }

    ctx.pass({
      title: NEON_ATTESTATION.objectStorage.control,
      description: `${bucketCount} bucket(s) across ${storageEnabledCount} of ${projects.length} checked project(s) are covered by ${NEON_ATTESTATION.objectStorage.algorithm} encryption at rest; ${publicCount} are publicly readable.`,
      resourceType: 'neon',
      resourceId: 'bucket-encrypted',
      evidence: {
        ...attestation,
        checkedProjectCount: projects.length,
        projectsWithObjectStorage: storageEnabledCount,
        bucketCount,
        publiclyReadableBucketCount: publicCount,
        filterMode: scope.filter.mode,
        checkedAt: scope.checkedAt,
      },
    });

    ctx.log(
      `Neon bucket check complete: ${bucketCount} bucket(s), ${publicCount} publicly readable`,
    );
  },
};
