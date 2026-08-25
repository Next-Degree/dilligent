import { auth } from '@/app/lib/auth';
import { db } from '@db/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  portalTaskId: z.string().min(1),
  organizationId: z.string().min(1),
});

/**
 * Marks a custom portal task complete for the authenticated employee.
 *
 * Portal self-service is authorized by session + organization membership, NOT
 * by the org RBAC role — mirroring `complete-training` and `accept-policies`.
 * Employees on custom roles that lack `portal:update` must still be able to
 * complete their own tasks, which is why this does not go through the
 * RBAC-gated NestJS `/v1/portal-tasks/:id/complete`.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  const { portalTaskId, organizationId } = parsed.data;

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

  // Scope the task to the caller's org so a task id from another tenant can
  // never be completed here, and refuse drafts/archived tasks — neither is
  // assigned to anyone.
  const task = await db.portalTask.findFirst({
    where: {
      id: portalTaskId,
      organizationId,
      isPublished: true,
      isArchived: false,
    },
    select: { id: true, acknowledgementText: true },
  });

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // Upsert on the (portalTaskId, memberId) unique constraint. A find-then-create
  // flow races under concurrent requests; the upsert is atomic and the empty
  // update keeps the original completedAt, so the evidence trail records when
  // the member first confirmed.
  const record = await db.portalTaskCompletion.upsert({
    where: {
      portalTaskId_memberId: { portalTaskId: task.id, memberId: member.id },
    },
    create: {
      portalTaskId: task.id,
      memberId: member.id,
      acknowledgedText: task.acknowledgementText,
    },
    update: {},
  });

  return NextResponse.json({ success: true, data: record });
}
