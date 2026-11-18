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
  isTrainingCompliant,
  isTrainingVideoId,
  latestCompletionFor,
  resolveCompletionTarget,
} from '@trycompai/company';
import { TrainingEmailService } from './training-email.service';
import { TrainingCertificatePdfService } from './training-certificate-pdf.service';
import {
  generateGroupCertificate,
  sendGroupCompletionEmail,
} from './training-certificates';
import {
  getGroupStatus,
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
      refreshesStale: target.refreshesStale,
    });

    await this.sendCompletionEmailIfCycleFinished({
      memberId,
      organizationId,
      videoId,
      cycle: target.cycle,
    });

    return record;
  }

  sendTrainingCompletionEmailIfComplete(
    memberId: string,
    organizationId: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    return sendGroupCompletionEmail({
      groupId: 'general',
      memberId,
      organizationId,
      emailService: this.trainingEmailService,
    });
  }

  sendHipaaCompletionEmailIfComplete(
    memberId: string,
    organizationId: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    return sendGroupCompletionEmail({
      groupId: 'hipaa',
      memberId,
      organizationId,
      emailService: this.trainingEmailService,
    });
  }

  sendCcpaCompletionEmailIfComplete(
    memberId: string,
    organizationId: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    return sendGroupCompletionEmail({
      groupId: 'ccpa',
      memberId,
      organizationId,
      emailService: this.trainingEmailService,
    });
  }

  generateCertificate(memberId: string, organizationId: string) {
    return generateGroupCertificate({
      groupId: 'general',
      memberId,
      organizationId,
      pdfService: this.trainingCertificatePdfService,
    });
  }

  generateHipaaCertificate(memberId: string, organizationId: string) {
    return generateGroupCertificate({
      groupId: 'hipaa',
      memberId,
      organizationId,
      pdfService: this.trainingCertificatePdfService,
    });
  }

  generateCcpaCertificate(memberId: string, organizationId: string) {
    return generateGroupCertificate({
      groupId: 'ccpa',
      memberId,
      organizationId,
      pdfService: this.trainingCertificatePdfService,
    });
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
      // Only a cycle this completion finished, and only if it is valid: a
      // certificate for training that is already expired would be misleading.
      // Due for renewal still counts: the training is valid, just near its end.
      if (!isTrainingCompliant(status) || status.cycle !== cycle) return;

      await sendGroupCompletionEmail({
        groupId: group.id,
        memberId,
        organizationId,
        emailService: this.trainingEmailService,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send ${group.title} completion email for member ${memberId}:`,
        error,
      );
    }
  }
}
