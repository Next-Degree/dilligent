import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard, PERMISSIONS_KEY } from '../auth/permission.guard';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@trycompai/auth', () => ({
  statement: {},
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

describe('TrainingController CCPA endpoints', () => {
  let controller: TrainingController;

  const mockTrainingService = {
    sendCcpaCompletionEmailIfComplete: jest.fn(),
    generateCcpaCertificate: jest.fn(),
  };
  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };
  const mockResponse = { setHeader: jest.fn(), send: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrainingController],
      providers: [{ provide: TrainingService, useValue: mockTrainingService }],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<TrainingController>(TrainingController);
    jest.clearAllMocks();
  });

  it('sends the CCPA completion email for the member in the caller org', async () => {
    mockTrainingService.sendCcpaCompletionEmailIfComplete.mockResolvedValue({
      sent: true,
    });

    const result = await controller.sendCcpaTrainingCompletionEmail('org_1', {
      memberId: 'mem_1',
    });

    expect(result).toEqual({ sent: true });
    expect(
      mockTrainingService.sendCcpaCompletionEmailIfComplete,
    ).toHaveBeenCalledWith('mem_1', 'org_1');
  });

  it('streams the CCPA certificate as a PDF download', async () => {
    const pdf = Buffer.from('%PDF-ccpa');
    mockTrainingService.generateCcpaCertificate.mockResolvedValue({
      pdf,
      fileName: 'ccpa-training-certificate-ada.pdf',
    });

    await controller.generateCcpaCertificate(
      'org_1',
      { memberId: 'mem_1' },
      mockResponse as never,
    );

    expect(mockTrainingService.generateCcpaCertificate).toHaveBeenCalledWith(
      'mem_1',
      'org_1',
    );
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="ccpa-training-certificate-ada.pdf"',
    );
    expect(mockResponse.send).toHaveBeenCalledWith(pdf);
  });

  it('rejects the certificate request when the training is not complete', async () => {
    mockTrainingService.generateCcpaCertificate.mockResolvedValue({
      error: 'ccpa_training_not_complete',
    });

    await expect(
      controller.generateCcpaCertificate(
        'org_1',
        { memberId: 'mem_1' },
        mockResponse as never,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockResponse.send).not.toHaveBeenCalled();
  });

  it('requires training:update to send the CCPA email', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        TrainingController.prototype.sendCcpaTrainingCompletionEmail,
      ),
    ).toEqual([{ resource: 'training', actions: ['update'] }]);
  });

  it('requires training:read to generate the CCPA certificate', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        TrainingController.prototype.generateCcpaCertificate,
      ),
    ).toEqual([{ resource: 'training', actions: ['read'] }]);
  });
});
