import { Logger } from '@nestjs/common';
import type { TrainingGroupId } from '@trycompai/company';
import type { TrainingCertificatePdfService } from './training-certificate-pdf.service';
import { getLatestCompletionDate } from './training-completions';
import type { TrainingEmailService } from './training-email.service';
import { resolveMemberForCertificate } from './training-member';

const logger = new Logger('TrainingCertificates');

/** How each training group's certificate is named and reported when missing. */
const CERTIFICATES: Record<
  TrainingGroupId,
  { notCompleteReason: string; filePrefix: string }
> = {
  general: {
    notCompleteReason: 'training_not_complete',
    filePrefix: 'training-certificate',
  },
  hipaa: {
    notCompleteReason: 'hipaa_training_not_complete',
    filePrefix: 'hipaa-training-certificate',
  },
  ccpa: {
    notCompleteReason: 'ccpa_training_not_complete',
    filePrefix: 'ccpa-training-certificate',
  },
};

/**
 * Email the member their certificate for a training group, if they have
 * finished it. Dated from their latest finished cycle.
 */
export async function sendGroupCompletionEmail({
  groupId,
  memberId,
  organizationId,
  emailService,
}: {
  groupId: TrainingGroupId;
  memberId: string;
  organizationId: string;
  emailService: TrainingEmailService;
}): Promise<{ sent: boolean; reason?: string }> {
  // Resolve the member first: it checks they belong to the caller's org, so
  // nothing about another org's member (not even whether they finished the
  // training) can be learned from the response.
  const resolved = await resolveMemberForCertificate({
    memberId,
    organizationId,
  });
  if ('reason' in resolved) return { sent: false, reason: resolved.reason };

  const completedAt = await getLatestCompletionDate({ memberId, groupId });
  if (!completedAt) {
    return { sent: false, reason: CERTIFICATES[groupId].notCompleteReason };
  }

  const recipient = {
    toEmail: resolved.email,
    toName: resolved.userName,
    organizationName: resolved.organizationName,
    completedAt,
  };
  switch (groupId) {
    case 'general':
      await emailService.sendTrainingCompletedEmail(recipient);
      break;
    case 'hipaa':
      await emailService.sendHipaaTrainingCompletedEmail(recipient);
      break;
    case 'ccpa':
      await emailService.sendCcpaTrainingCompletedEmail(recipient);
      break;
  }

  logger.log(`${groupId} training completion email sent to ${resolved.email}`);
  return { sent: true };
}

/** The certificate PDF for a training group the member has finished. */
export async function generateGroupCertificate({
  groupId,
  memberId,
  organizationId,
  pdfService,
}: {
  groupId: TrainingGroupId;
  memberId: string;
  organizationId: string;
  pdfService: TrainingCertificatePdfService;
}): Promise<{ pdf: Buffer; fileName: string } | { error: string }> {
  // Resolve the member first, which checks the org (see above).
  const resolved = await resolveMemberForCertificate({
    memberId,
    organizationId,
  });
  if ('reason' in resolved) return { error: resolved.reason };

  const completedAt = await getLatestCompletionDate({ memberId, groupId });
  if (!completedAt) return { error: CERTIFICATES[groupId].notCompleteReason };

  const details = {
    userName: resolved.userName,
    organizationName: resolved.organizationName,
    completedAt,
  };
  const pdf =
    groupId === 'general'
      ? await pdfService.generateTrainingCertificatePdf(details)
      : groupId === 'hipaa'
        ? await pdfService.generateHipaaCertificatePdf(details)
        : await pdfService.generateCcpaCertificatePdf(details);

  return {
    pdf,
    fileName: `${CERTIFICATES[groupId].filePrefix}-${resolved.userName.replace(/\s+/g, '-').toLowerCase()}.pdf`,
  };
}
