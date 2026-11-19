jest.mock('@db', () => ({
  db: {
    member: { findUnique: jest.fn() },
    employeeTrainingVideoCompletion: { findMany: jest.fn() },
  },
}));

import {
  generateGroupCertificate,
  sendGroupCompletionEmail,
} from './training-certificates';
import { GENERAL, rowsFor } from './training-fixtures-spec';

const { db } = jest.requireMock('@db');

const pdfService = {
  generateTrainingCertificatePdf: jest.fn(),
  generateHipaaCertificatePdf: jest.fn(),
  generateCcpaCertificatePdf: jest.fn(),
};
const emailService = {
  sendTrainingCompletedEmail: jest.fn(),
  sendHipaaTrainingCompletedEmail: jest.fn(),
  sendCcpaTrainingCompletedEmail: jest.fn(),
};

const member = (overrides: Record<string, unknown> = {}) => ({
  id: 'mem_1',
  organizationId: 'org_1',
  user: { email: 'ada@acme.com', name: 'Ada Lovelace' },
  organization: { name: 'Acme' },
  ...overrides,
});

const certificate = (groupId: 'general' | 'hipaa' | 'ccpa') =>
  generateGroupCertificate({
    groupId,
    memberId: 'mem_1',
    organizationId: 'org_1',
    pdfService: pdfService as never,
  });

describe('training certificates', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    db.member.findUnique.mockResolvedValue(member());
    db.employeeTrainingVideoCompletion.findMany.mockResolvedValue([]);
    for (const fn of Object.values(pdfService)) {
      fn.mockResolvedValue(Buffer.from('pdf'));
    }
  });

  it('keeps the general and HIPAA certificate file names, and names the CCPA one alike', async () => {
    db.employeeTrainingVideoCompletion.findMany.mockResolvedValue([
      ...rowsFor({ videoIds: GENERAL, days: 5 }),
      ...rowsFor({ videoIds: ['hipaa-sat-1'], days: 5 }),
      ...rowsFor({ videoIds: ['ccpa-1', 'ccpa-2'], days: 5 }),
    ]);

    await expect(certificate('general')).resolves.toMatchObject({
      fileName: 'training-certificate-ada-lovelace.pdf',
    });
    await expect(certificate('hipaa')).resolves.toMatchObject({
      fileName: 'hipaa-training-certificate-ada-lovelace.pdf',
    });
    await expect(certificate('ccpa')).resolves.toMatchObject({
      fileName: 'ccpa-training-certificate-ada-lovelace.pdf',
    });
  });

  it('reports a member that does not exist', async () => {
    db.member.findUnique.mockResolvedValue(null);

    await expect(certificate('ccpa')).resolves.toEqual({
      error: 'member_not_found',
    });
  });

  it('reports a member without an email when emailing', async () => {
    db.member.findUnique.mockResolvedValue(
      member({ user: { email: '', name: 'Ada Lovelace' } }),
    );
    db.employeeTrainingVideoCompletion.findMany.mockResolvedValue(
      rowsFor({ videoIds: ['ccpa-1', 'ccpa-2'], days: 5 }),
    );

    await expect(
      sendGroupCompletionEmail({
        groupId: 'ccpa',
        memberId: 'mem_1',
        organizationId: 'org_1',
        emailService: emailService as never,
      }),
    ).resolves.toEqual({ sent: false, reason: 'no_email' });
    expect(emailService.sendCcpaTrainingCompletedEmail).not.toHaveBeenCalled();
  });

  it("does not reveal another org's member's training status", async () => {
    db.member.findUnique.mockResolvedValue(
      member({ organizationId: 'org_other' }),
    );

    await expect(certificate('ccpa')).resolves.toEqual({
      error: 'organization_mismatch',
    });
    await expect(
      sendGroupCompletionEmail({
        groupId: 'ccpa',
        memberId: 'mem_1',
        organizationId: 'org_1',
        emailService: emailService as never,
      }),
    ).resolves.toEqual({ sent: false, reason: 'organization_mismatch' });
    expect(db.employeeTrainingVideoCompletion.findMany).not.toHaveBeenCalled();
  });

  const email = () =>
    sendGroupCompletionEmail({
      groupId: 'ccpa',
      memberId: 'mem_1',
      organizationId: 'org_1',
      emailService: emailService as never,
    });

  it('does not congratulate a member whose training has expired', async () => {
    db.employeeTrainingVideoCompletion.findMany.mockResolvedValue(
      rowsFor({ videoIds: ['ccpa-1', 'ccpa-2'], days: 400 }),
    );

    await expect(email()).resolves.toEqual({ sent: false, reason: 'training_expired' });
    expect(emailService.sendCcpaTrainingCompletedEmail).not.toHaveBeenCalled();
    // The certificate itself still records the completion.
    await expect(certificate('ccpa')).resolves.toMatchObject({ pdf: expect.any(Buffer) });
  });

  it('still emails a member who is only due for renewal', async () => {
    db.employeeTrainingVideoCompletion.findMany.mockResolvedValue(
      rowsFor({ videoIds: ['ccpa-1', 'ccpa-2'], days: 330 }),
    );

    await expect(email()).resolves.toEqual({ sent: true });
    expect(emailService.sendCcpaTrainingCompletedEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['李小龙', 'ccpa-training-certificate-member.pdf'],
    ['Ada "The Countess" Lovelace', 'ccpa-training-certificate-ada-the-countess-lovelace.pdf'],
    ['  José  Núñez ', 'ccpa-training-certificate-jos-n-ez.pdf'],
  ])('names the certificate for %j with header-safe characters only', async (name, fileName) => {
    db.member.findUnique.mockResolvedValue(member({ user: { email: 'x@acme.com', name } }));
    db.employeeTrainingVideoCompletion.findMany.mockResolvedValue(
      rowsFor({ videoIds: ['ccpa-1', 'ccpa-2'], days: 5 }),
    );

    await expect(certificate('ccpa')).resolves.toMatchObject({ fileName });
  });
});
