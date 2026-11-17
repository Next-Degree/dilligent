import { Injectable, Logger } from '@nestjs/common';
import { triggerEmail } from '../email/trigger-email';
import { CcpaTrainingCompletedEmail } from '../email/templates/ccpa-training-completed';
import { HipaaTrainingCompletedEmail } from '../email/templates/hipaa-training-completed';
import { TrainingCompletedEmail } from '../email/templates/training-completed';
import { TrainingCertificatePdfService } from './training-certificate-pdf.service';

interface CompletionEmailRecipient {
  toEmail: string;
  toName: string;
  organizationName: string;
  completedAt: Date;
}

interface CertificateDetails {
  userName: string;
  organizationName: string;
  completedAt: Date;
}

type EmailContent = Parameters<typeof triggerEmail>[0]['react'];

@Injectable()
export class TrainingEmailService {
  private readonly logger = new Logger(TrainingEmailService.name);

  constructor(
    private readonly certificatePdfService: TrainingCertificatePdfService,
  ) {}

  async sendTrainingCompletedEmail(
    recipient: CompletionEmailRecipient,
  ): Promise<void> {
    await this.sendCertificateEmail({
      recipient,
      trainingName: 'Security Awareness Training',
      filePrefix: 'security-awareness-training-certificate',
      renderPdf: (details) =>
        this.certificatePdfService.generateTrainingCertificatePdf(details),
      renderEmail: TrainingCompletedEmail,
    });
  }

  async sendHipaaTrainingCompletedEmail(
    recipient: CompletionEmailRecipient,
  ): Promise<void> {
    await this.sendCertificateEmail({
      recipient,
      trainingName: 'HIPAA Security Awareness Training',
      filePrefix: 'hipaa-training-certificate',
      renderPdf: (details) =>
        this.certificatePdfService.generateHipaaCertificatePdf(details),
      renderEmail: HipaaTrainingCompletedEmail,
    });
  }

  async sendCcpaTrainingCompletedEmail(
    recipient: CompletionEmailRecipient,
  ): Promise<void> {
    await this.sendCertificateEmail({
      recipient,
      trainingName: 'CCPA Privacy Training',
      filePrefix: 'ccpa-training-certificate',
      renderPdf: (details) =>
        this.certificatePdfService.generateCcpaCertificatePdf(details),
      renderEmail: CcpaTrainingCompletedEmail,
    });
  }

  /** Render the certificate, then email it as an attachment. */
  private async sendCertificateEmail({
    recipient,
    trainingName,
    filePrefix,
    renderPdf,
    renderEmail,
  }: {
    recipient: CompletionEmailRecipient;
    trainingName: string;
    filePrefix: string;
    renderPdf: (details: CertificateDetails) => Promise<Buffer>;
    renderEmail: (props: {
      email: string;
      userName: string;
      organizationName: string;
      completedAt: Date;
    }) => EmailContent;
  }): Promise<void> {
    const { toEmail, toName, organizationName, completedAt } = recipient;

    const certificatePdf = await renderPdf({
      userName: toName,
      organizationName,
      completedAt,
    });

    this.logger.log(
      `Generated ${trainingName} certificate PDF for ${toEmail} (${certificatePdf.length} bytes)`,
    );

    const safeUserName = toName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

    const { id } = await triggerEmail({
      to: toEmail,
      subject: `Congratulations! You've completed your ${trainingName} - ${organizationName}`,
      react: renderEmail({
        email: toEmail,
        userName: toName,
        organizationName,
        completedAt,
      }),
      system: true,
      attachments: [
        {
          filename: `${filePrefix}-${safeUserName}.pdf`,
          content: certificatePdf,
          contentType: 'application/pdf',
        },
      ],
    });

    this.logger.log(
      `${trainingName} completed email sent to ${toEmail} with certificate (ID: ${id})`,
    );
  }
}
