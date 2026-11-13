import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { db } from '@db';
import {
  frameworkGateForModule,
  frameworkInstanceWhere,
  groupForModule,
  isTrainingVideoId,
  latestCompletionFor,
  resolveCompletionTarget,
  type TrainingGroupId,
} from '@trycompai/company';
import { TrainingEmailService } from './training-email.service';
import { TrainingCertificatePdfService } from './training-certificate-pdf.service';
import { resolveMemberForCertificate } from './training-member';
import {
  getGroupStatus,
  getLatestCompletionDate,
  listMemberCompletions,
  recordModuleCompletion,
} from './training-completions';

@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);

  constructor(
    private readonly trainingEmailService: TrainingEmailService,
    private readonly trainingCertificatePdfService: TrainingCertificatePdfService,
  ) {}

  async getCompletions(memberId: string, organizationId: string) {
    const member = await db.member.findFirst({
      where: { id: memberId, organizationId, deactivated: false },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    return db.employeeTrainingVideoCompletion.findMany({
      where: { memberId },
    });
  }

  async markVideoComplete(
    memberId: string,
    organizationId: string,
    videoId: string,
  ) {
    if (!isTrainingVideoId(videoId)) {
      throw new BadRequestException(`Invalid video ID: ${videoId}`);
    }

    await this.assertTrainingAvailable({ organizationId, videoId });

    const member = await db.member.findFirst({
      where: { id: memberId, organizationId, deactivated: false },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const completions = await listMemberCompletions(memberId);
    const target = resolveCompletionTarget({
      moduleId: videoId,
      completions,
      now: new Date(),
    });

    // Not due yet, or already finished this cycle: nothing to write, and no
    // email, so a repeated request cannot re-stamp a completion or re-notify.
    if (target.action === 'ignore') {
      const existing = latestCompletionFor({ completions, videoId });
      if (!existing)
        throw new NotFoundException('Training completion not found');
      return existing;
    }

    const record = await recordModuleCompletion({
      memberId,
      videoId,
      cycle: target.cycle,
    });

    await this.sendCompletionEmailIfCycleFinished({
      memberId,
      organizationId,
      videoId,
      cycle: target.cycle,
    });

    return record;
  }

  async sendTrainingCompletionEmailIfComplete(
    memberId: string,
    organizationId: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    const completedAt = await getLatestCompletionDate({
      memberId,
      groupId: 'general',
    });
    if (!completedAt) return { sent: false, reason: 'training_not_complete' };

    const resolved = await resolveMemberForCertificate({
      memberId,
      organizationId,
    });
    if ('reason' in resolved) return { sent: false, reason: resolved.reason };

    await this.trainingEmailService.sendTrainingCompletedEmail({
      toEmail: resolved.email,
      toName: resolved.userName,
      organizationName: resolved.organizationName,
      completedAt,
    });
    this.logger.log(`Training completion email sent to ${resolved.email}`);
    return { sent: true };
  }

  async generateCertificate(
    memberId: string,
    organizationId: string,
  ): Promise<{ pdf: Buffer; fileName: string } | { error: string }> {
    const completedAt = await getLatestCompletionDate({
      memberId,
      groupId: 'general',
    });
    if (!completedAt) return { error: 'training_not_complete' };

    const resolved = await resolveMemberForCertificate({
      memberId,
      organizationId,
    });
    if ('reason' in resolved) return { error: resolved.reason };

    const pdf =
      await this.trainingCertificatePdfService.generateTrainingCertificatePdf({
        userName: resolved.userName,
        organizationName: resolved.organizationName,
        completedAt,
      });

    return {
      pdf,
      fileName: `training-certificate-${resolved.userName.replace(/\s+/g, '-').toLowerCase()}.pdf`,
    };
  }

  async sendHipaaCompletionEmailIfComplete(
    memberId: string,
    organizationId: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    const completedAt = await getLatestCompletionDate({
      memberId,
      groupId: 'hipaa',
    });
    if (!completedAt)
      return { sent: false, reason: 'hipaa_training_not_complete' };

    const resolved = await resolveMemberForCertificate({
      memberId,
      organizationId,
    });
    if ('reason' in resolved) return { sent: false, reason: resolved.reason };

    await this.trainingEmailService.sendHipaaTrainingCompletedEmail({
      toEmail: resolved.email,
      toName: resolved.userName,
      organizationName: resolved.organizationName,
      completedAt,
    });
    this.logger.log(
      `HIPAA training completion email sent to ${resolved.email}`,
    );
    return { sent: true };
  }

  async generateHipaaCertificate(
    memberId: string,
    organizationId: string,
  ): Promise<{ pdf: Buffer; fileName: string } | { error: string }> {
    const completedAt = await getLatestCompletionDate({
      memberId,
      groupId: 'hipaa',
    });
    if (!completedAt) return { error: 'hipaa_training_not_complete' };

    const resolved = await resolveMemberForCertificate({
      memberId,
      organizationId,
    });
    if ('reason' in resolved) return { error: resolved.reason };

    const pdf =
      await this.trainingCertificatePdfService.generateHipaaCertificatePdf({
        userName: resolved.userName,
        organizationName: resolved.organizationName,
        completedAt,
      });

    return {
      pdf,
      fileName: `hipaa-training-certificate-${resolved.userName.replace(/\s+/g, '-').toLowerCase()}.pdf`,
    };
  }

  /**
   * Reject framework gated modules for orgs without that framework. Shared
   * with the portal's completion route through `frameworkGateForModule`, so
   * the two write paths cannot disagree about which orgs may complete what.
   */
  private async assertTrainingAvailable({
    organizationId,
    videoId,
  }: {
    organizationId: string;
    videoId: string;
  }): Promise<void> {
    const gate = frameworkGateForModule(videoId);
    if (!gate) return;

    const instance = await db.frameworkInstance.findFirst({
      where: frameworkInstanceWhere({
        organizationId,
        frameworkName: gate.frameworkName,
      }),
      select: { id: true },
    });
    if (!instance) {
      throw new BadRequestException(gate.unavailableMessage);
    }
  }

  /**
   * Email the member only when this completion is the one that finished a
   * cycle. Last year's finished cycle must not make every module of a renewal
   * look like a fresh completion.
   */
  private async sendCompletionEmailIfCycleFinished({
    memberId,
    organizationId,
    videoId,
    cycle,
  }: {
    memberId: string;
    organizationId: string;
    videoId: string;
    cycle: number;
  }): Promise<void> {
    const group = groupForModule(videoId);
    if (!group) return;

    try {
      const status = await getGroupStatus({ memberId, groupId: group.id });
      if (status.status === 'incomplete' || status.cycle !== cycle) return;

      await this.sendCompletionEmail({
        groupId: group.id,
        memberId,
        organizationId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send ${group.title} completion email for member ${memberId}:`,
        error,
      );
    }
  }

  private async sendCompletionEmail({
    groupId,
    memberId,
    organizationId,
  }: {
    groupId: TrainingGroupId;
    memberId: string;
    organizationId: string;
  }): Promise<void> {
    if (groupId === 'general') {
      await this.sendTrainingCompletionEmailIfComplete(
        memberId,
        organizationId,
      );
    } else if (groupId === 'hipaa') {
      await this.sendHipaaCompletionEmailIfComplete(memberId, organizationId);
    }
  }
}
