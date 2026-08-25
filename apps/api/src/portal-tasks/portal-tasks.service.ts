import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { filterComplianceMembers } from '../utils/compliance-filters';
import type { CreatePortalTaskDto } from './dto/create-portal-task.dto';
import type { UpdatePortalTaskDto } from './dto/update-portal-task.dto';

/**
 * Portal tasks are assigned to the whole portal audience — every active member
 * carrying the `compliance` obligation, the same audience as policies and
 * training. There is no per-member targeting, so "assigning" a task means
 * publishing it, and progress is derived from PortalTaskCompletion rows.
 */
@Injectable()
export class PortalTasksService {
  async listForManagement(organizationId: string, includeArchived = false) {
    const [tasks, audienceMemberIds] = await Promise.all([
      db.portalTask.findMany({
        where: {
          organizationId,
          ...(includeArchived ? {} : { isArchived: false }),
        },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        include: { completions: { select: { memberId: true } } },
      }),
      this.getAudienceMemberIds(organizationId),
    ]);

    const audience = new Set(audienceMemberIds);

    return tasks.map(({ completions, ...task }) => ({
      ...task,
      // Completions from members who have since left the audience would
      // otherwise inflate progress past 100%.
      completedCount: completions.filter((c) => audience.has(c.memberId))
        .length,
      audienceCount: audience.size,
    }));
  }

  async listCompletions(organizationId: string, taskId: string) {
    const task = await this.findTaskOrThrow(organizationId, taskId);

    const members = await db.member.findMany({
      where: { organizationId, isActive: true, deactivated: false },
      select: {
        id: true,
        role: true,
        user: { select: { name: true, email: true, role: true } },
      },
    });
    const audience = await filterComplianceMembers(members, organizationId);

    const completions = await db.portalTaskCompletion.findMany({
      where: { portalTaskId: task.id },
      select: { memberId: true, completedAt: true },
    });
    const completedAtByMember = new Map(
      completions.map((c) => [c.memberId, c.completedAt]),
    );

    return audience.map((member) => ({
      memberId: member.id,
      name: member.user?.name ?? null,
      email: member.user?.email ?? null,
      completedAt: completedAtByMember.get(member.id) ?? null,
    }));
  }

  async create(
    organizationId: string,
    memberId: string | undefined,
    dto: CreatePortalTaskDto,
  ) {
    const kind = dto.kind ?? 'acknowledgement';
    this.assertLinkHasUrl(kind, dto.externalUrl ?? null);

    return db.portalTask.create({
      data: {
        organizationId,
        title: dto.title,
        description: dto.description ?? null,
        kind,
        externalUrl: dto.externalUrl ?? null,
        acknowledgementText: dto.acknowledgementText ?? null,
        isPublished: dto.isPublished ?? false,
        isRequired: dto.isRequired ?? true,
        order: dto.order ?? 0,
        createdByMemberId: memberId ?? null,
      },
    });
  }

  async update(
    organizationId: string,
    taskId: string,
    dto: UpdatePortalTaskDto,
  ) {
    const existing = await this.findTaskOrThrow(organizationId, taskId);

    const kind = dto.kind ?? existing.kind;
    const externalUrl =
      dto.externalUrl !== undefined ? dto.externalUrl : existing.externalUrl;
    this.assertLinkHasUrl(kind, externalUrl);

    return db.portalTask.update({
      where: { id: existing.id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.kind !== undefined && { kind: dto.kind }),
        ...(dto.externalUrl !== undefined && { externalUrl: dto.externalUrl }),
        ...(dto.acknowledgementText !== undefined && {
          acknowledgementText: dto.acknowledgementText,
        }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
        ...(dto.isRequired !== undefined && { isRequired: dto.isRequired }),
        ...(dto.isArchived !== undefined && { isArchived: dto.isArchived }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });
  }

  /**
   * Archive rather than delete — completion records are compliance evidence
   * and an auditor may need them after the task leaves the portal.
   */
  async archive(organizationId: string, taskId: string) {
    const existing = await this.findTaskOrThrow(organizationId, taskId);

    return db.portalTask.update({
      where: { id: existing.id },
      data: { isArchived: true },
    });
  }

  async listAssigned(organizationId: string, memberId: string) {
    await this.assertMemberInOrg(organizationId, memberId);

    const tasks = await db.portalTask.findMany({
      where: { organizationId, isPublished: true, isArchived: false },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: {
        completions: {
          where: { memberId },
          select: { completedAt: true },
        },
      },
    });

    return tasks.map(({ completions, ...task }) => ({
      ...task,
      completedAt: completions[0]?.completedAt ?? null,
    }));
  }

  async complete(organizationId: string, memberId: string, taskId: string) {
    await this.assertMemberInOrg(organizationId, memberId);

    const task = await db.portalTask.findFirst({
      where: {
        id: taskId,
        organizationId,
        isPublished: true,
        isArchived: false,
      },
    });

    if (!task) {
      throw new NotFoundException('Portal task not found');
    }

    // Idempotent: re-confirming keeps the original completedAt so the evidence
    // trail reflects when the member first agreed.
    return db.portalTaskCompletion.upsert({
      where: {
        portalTaskId_memberId: { portalTaskId: task.id, memberId },
      },
      create: {
        portalTaskId: task.id,
        memberId,
        acknowledgedText: task.acknowledgementText,
      },
      update: {},
    });
  }

  private assertLinkHasUrl(kind: string, externalUrl: string | null) {
    if (kind === 'link' && !externalUrl) {
      throw new BadRequestException(
        'externalUrl is required when kind is "link"',
      );
    }
  }

  private async findTaskOrThrow(organizationId: string, taskId: string) {
    const task = await db.portalTask.findFirst({
      where: { id: taskId, organizationId },
    });

    if (!task) {
      throw new NotFoundException('Portal task not found');
    }

    return task;
  }

  private async assertMemberInOrg(organizationId: string, memberId: string) {
    const member = await db.member.findFirst({
      where: { id: memberId, organizationId, deactivated: false },
      select: { id: true },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }
  }

  private async getAudienceMemberIds(organizationId: string) {
    const members = await db.member.findMany({
      where: { organizationId, isActive: true, deactivated: false },
      select: { id: true, role: true, user: { select: { role: true } } },
    });
    const audience = await filterComplianceMembers(members, organizationId);

    return audience.map((member) => member.id);
  }
}
