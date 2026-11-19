jest.mock('../email/trigger-email', () => ({
  triggerEmail: jest.fn(),
}));
// The React email templates are rendered by the email pipeline, not here.
jest.mock('../email/templates/training-completed', () => ({
  TrainingCompletedEmail: jest.fn(() => 'general-email'),
}));
jest.mock('../email/templates/hipaa-training-completed', () => ({
  HipaaTrainingCompletedEmail: jest.fn(() => 'hipaa-email'),
}));
jest.mock('../email/templates/ccpa-training-completed', () => ({
  CcpaTrainingCompletedEmail: jest.fn(() => 'ccpa-email'),
}));

import { triggerEmail } from '../email/trigger-email';
import { CcpaTrainingCompletedEmail } from '../email/templates/ccpa-training-completed';
import { HipaaTrainingCompletedEmail } from '../email/templates/hipaa-training-completed';
import { TrainingCompletedEmail } from '../email/templates/training-completed';
import { TrainingEmailService } from './training-email.service';

const mockTriggerEmail = triggerEmail as jest.Mock;

describe('TrainingEmailService completion emails', () => {
  const pdf = Buffer.from('%PDF-ccpa');
  const certificatePdfService = {
    generateTrainingCertificatePdf: jest.fn(),
    generateHipaaCertificatePdf: jest.fn(),
    generateCcpaCertificatePdf: jest.fn(),
  };
  let service: TrainingEmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    certificatePdfService.generateTrainingCertificatePdf.mockResolvedValue(pdf);
    certificatePdfService.generateHipaaCertificatePdf.mockResolvedValue(pdf);
    certificatePdfService.generateCcpaCertificatePdf.mockResolvedValue(pdf);
    mockTriggerEmail.mockResolvedValue({ id: 'em_1' });
    service = new TrainingEmailService(certificatePdfService as never);
  });

  it('emails the CCPA certificate as a PDF attachment', async () => {
    const completedAt = new Date('2026-11-01T10:00:00.000Z');

    await service.sendCcpaTrainingCompletedEmail({
      toEmail: 'ada@acme.com',
      toName: 'Ada Lovelace',
      organizationName: 'Acme',
      completedAt,
    });

    expect(
      certificatePdfService.generateCcpaCertificatePdf,
    ).toHaveBeenCalledWith({
      userName: 'Ada Lovelace',
      organizationName: 'Acme',
      completedAt,
    });
    expect(CcpaTrainingCompletedEmail).toHaveBeenCalledWith({
      email: 'ada@acme.com',
      userName: 'Ada Lovelace',
      organizationName: 'Acme',
      completedAt,
    });
    expect(mockTriggerEmail).toHaveBeenCalledWith({
      to: 'ada@acme.com',
      subject:
        "Congratulations! You've completed your CCPA Privacy Training - Acme",
      react: 'ccpa-email',
      system: true,
      attachments: [
        {
          filename: 'ccpa-training-certificate-ada-lovelace.pdf',
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
  });

  const recipient = {
    toEmail: 'ada@acme.com',
    toName: 'Ada Lovelace',
    organizationName: 'Acme',
    completedAt: new Date('2026-11-01T10:00:00.000Z'),
  };

  it('emails the general training certificate as before', async () => {
    await service.sendTrainingCompletedEmail(recipient);

    expect(TrainingCompletedEmail).toHaveBeenCalledWith({
      email: 'ada@acme.com',
      userName: 'Ada Lovelace',
      organizationName: 'Acme',
      completedAt: recipient.completedAt,
    });
    expect(mockTriggerEmail).toHaveBeenCalledWith({
      to: 'ada@acme.com',
      subject:
        "Congratulations! You've completed your Security Awareness Training - Acme",
      react: 'general-email',
      system: true,
      attachments: [
        {
          filename: 'security-awareness-training-certificate-ada-lovelace.pdf',
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
  });

  it('emails the HIPAA training certificate as before', async () => {
    await service.sendHipaaTrainingCompletedEmail(recipient);

    expect(HipaaTrainingCompletedEmail).toHaveBeenCalled();
    expect(mockTriggerEmail).toHaveBeenCalledWith({
      to: 'ada@acme.com',
      subject:
        "Congratulations! You've completed your HIPAA Security Awareness Training - Acme",
      react: 'hipaa-email',
      system: true,
      attachments: [
        {
          filename: 'hipaa-training-certificate-ada-lovelace.pdf',
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
  });
});
