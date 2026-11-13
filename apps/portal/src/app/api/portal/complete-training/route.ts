import { auth } from '@/app/lib/auth';
import { env } from '@/env.mjs';
import { db } from '@db/server';
import {
  assessTrainingGroup,
  frameworkGateForModule,
  frameworkInstanceWhere,
  groupForModule,
  isTrainingVideoId,
  latestCompletionFor,
  resolveCompletionTarget,
  type TrainingGroupId,
} from '@trycompai/company';
import { after, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The completion email hits the NestJS API, which resolves the member, renders
// a PDF certificate and calls the email provider — seconds of work. It runs
// after the response (see `after` below), but still needs a bound: Node's fetch
// waits ~5 minutes by default, which would pin the serverless invocation open
// long after the employee has moved on.
const COMPLETION_EMAIL_TIMEOUT_MS = 30_000;

/** The NestJS endpoint that emails a finished training group's certificate, where one exists. */
const COMPLETION_EMAIL_PATHS: Partial<Record<TrainingGroupId, string>> = {
  general: '/v1/training/send-completion-email',
  hipaa: '/v1/training/send-hipaa-completion-email',
};

const schema = z.object({
  videoId: z.string().min(1),
  organizationId: z.string().min(1),
});

/**
 * Marks a single training video complete for the authenticated employee.
 *
 * Portal self-service (signing policies, completing training) is authorized by
 * session + organization membership, NOT by the org RBAC role — mirroring
 * `accept-policies`. Employees on custom roles that lack `portal:update` (e.g.
 * roles created via the API, or before the compliance-obligation auto-grant)
 * must still be able to complete their own training, which is why this does not
 * go through the RBAC-gated NestJS `/v1/training/completions/:id/complete`.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // req.json() throws on a malformed/empty body. Catch it so the contract stays
  // a 400 "Invalid request body" instead of leaking an unhandled 500.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { videoId, organizationId } = parsed.data;

  if (!isTrainingVideoId(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
  }

  // Verify the authenticated user is an active member of the organization.
  const member = await db.member.findFirst({
    where: {
      userId: session.user.id,
      organizationId,
      deactivated: false,
    },
  });

  if (!member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Framework gated training (HIPAA, CCPA) is only available to orgs that have
  // that framework enabled. The rule comes from the shared catalog, the same
  // one the NestJS training service (markVideoComplete) uses, so this route
  // can't create completion records — and trigger certificate artifacts — for
  // orgs the service would reject, which would desync the two completion paths.
  const gate = frameworkGateForModule(videoId);
  if (gate) {
    const instance = await db.frameworkInstance.findFirst({
      where: frameworkInstanceWhere({ organizationId, frameworkName: gate.frameworkName }),
      select: { id: true },
    });
    if (!instance) {
      return NextResponse.json({ error: gate.unavailableMessage }, { status: 400 });
    }
  }

  // Training renews yearly, so a member can have a row per cycle for the same
  // module. The shared resolver decides which cycle this completion belongs to
  // (or that there is nothing to record), identically to the NestJS service.
  const completions = await db.employeeTrainingVideoCompletion.findMany({
    where: { memberId: member.id },
  });
  const target = resolveCompletionTarget({ moduleId: videoId, completions, now: new Date() });

  // Not due yet, or already finished this cycle: nothing to write and no email,
  // so a repeated request can't re-stamp a completion or re-notify.
  if (target.action === 'ignore') {
    const existing = latestCompletionFor({ completions, videoId });
    if (!existing) {
      return NextResponse.json({ error: 'Training completion not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: existing });
  }

  // Upsert on the (memberId, videoId, cycle) unique constraint. A
  // find-then-create flow races under concurrent requests — both callers see no
  // row, both create, and the second trips the unique constraint and 500s. The
  // upsert is atomic; the empty update leaves an existing row untouched.
  let record = await db.employeeTrainingVideoCompletion.upsert({
    where: { memberId_videoId_cycle: { memberId: member.id, videoId, cycle: target.cycle } },
    create: { videoId, memberId: member.id, cycle: target.cycle, completedAt: new Date() },
    update: {},
  });

  // A row can pre-exist with completedAt: null (video tracked but not finished).
  // Stamp it now, but never re-stamp an already-completed video so the recorded
  // completion time stays the first completion.
  if (!record.completedAt) {
    record = await db.employeeTrainingVideoCompletion.update({
      where: { id: record.id },
      data: { completedAt: new Date() },
    });
  }

  // Best-effort: trigger the completion certificate email once this completion
  // finishes the training. Reuses the NestJS email pipeline via the portal
  // service token, so we don't duplicate the certificate/email logic here.
  //
  // Deferred with `after` so it runs once the response has been sent. The
  // completion is already durable at this point, and the API call behind it
  // renders a PDF certificate and talks to the email provider — awaiting that
  // made the employee's click wait seconds on the happy path, and time out on
  // the unhappy one, for work whose outcome they never see.
  after(() =>
    sendCompletionEmailIfCycleFinished({
      videoId,
      memberId: member.id,
      organizationId,
      cycle: target.cycle,
    }),
  );

  return NextResponse.json({ success: true, data: record });
}

/**
 * Email the member only when this completion is the one that finished a cycle
 * of its training group. Last year's finished cycle must not make every module
 * of a renewal look like a fresh completion and re-send the certificate.
 */
async function sendCompletionEmailIfCycleFinished({
  videoId,
  memberId,
  organizationId,
  cycle,
}: {
  videoId: string;
  memberId: string;
  organizationId: string;
  cycle: number;
}): Promise<void> {
  const serviceToken = env.SERVICE_TOKEN_PORTAL;
  if (!serviceToken) return;

  const group = groupForModule(videoId);
  const emailPath = group ? COMPLETION_EMAIL_PATHS[group.id] : undefined;
  if (!group || !emailPath) return;

  const apiUrl = env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

  try {
    const completions = await db.employeeTrainingVideoCompletion.findMany({
      where: { memberId },
    });
    const status = assessTrainingGroup({ group, completions, now: new Date() });
    if (status.status === 'incomplete' || status.cycle !== cycle) return;

    await triggerCompletionEmail({
      url: `${apiUrl}${emailPath}`,
      serviceToken,
      memberId,
      organizationId,
    });
  } catch (error) {
    // Use console.error, NOT the dev-only `logger` — a failed completion email is a
    // real operational error we must see in production (the `logger` util no-ops
    // outside development, which silently swallowed these failures).
    // eslint-disable-next-line no-console
    console.error('Error triggering training completion email', {
      error: error instanceof Error ? error.message : String(error),
      memberId,
    });
  }
}

async function triggerCompletionEmail({
  url,
  serviceToken,
  memberId,
  organizationId,
}: {
  url: string;
  serviceToken: string;
  memberId: string;
  organizationId: string;
}): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-token': serviceToken,
      'x-organization-id': organizationId,
    },
    body: JSON.stringify({ memberId }),
    signal: AbortSignal.timeout(COMPLETION_EMAIL_TIMEOUT_MS),
  });

  // fetch only rejects on network errors, never on a 4xx/5xx response. Without
  // this check an HTTP failure (e.g. the API rejecting the service token) would
  // be treated as a successful send, so the caller's catch would never log the
  // delivery failure.
  if (!response.ok) {
    throw new Error(
      `Training completion email request to ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
}
