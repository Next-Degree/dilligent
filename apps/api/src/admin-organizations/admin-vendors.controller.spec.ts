import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminVendorsController } from './admin-vendors.controller';
import { VendorsService } from '../vendors/vendors.service';

jest.mock('../auth/platform-admin.guard', () => ({
  PlatformAdminGuard: class {
    canActivate() {
      return true;
    }
  },
}));

jest.mock('../auth/auth.server', () => ({
  auth: { api: {} },
}));

jest.mock('@db', () => ({
  db: {},
  VendorCategory: {
    cloud_infrastructure: 'cloud_infrastructure',
    engineering_developer_tools: 'engineering_developer_tools',
    security_compliance: 'security_compliance',
    identity_access_management: 'identity_access_management',
    artificial_intelligence: 'artificial_intelligence',
    data_provider: 'data_provider',
    data_enrichment: 'data_enrichment',
    data_collection: 'data_collection',
    automation_integration: 'automation_integration',
    analytics_observability: 'analytics_observability',
    collaboration_productivity: 'collaboration_productivity',
    design_creative: 'design_creative',
    finance: 'finance',
    marketing: 'marketing',
    sales: 'sales',
    hr_recruiting: 'hr_recruiting',
    legal: 'legal',
    customer_support: 'customer_support',
    other: 'other',
  },
  VendorStatus: {
    not_assessed: 'not_assessed',
    in_progress: 'in_progress',
    assessed: 'assessed',
  },
  // Pulled in via AdminAuditLogInterceptor, which builds its lookup tables at
  // module load — an absent enum here throws before any test runs.
  AuditLogEntityType: {
    organization: 'organization',
    people: 'people',
    control: 'control',
    task: 'task',
    policy: 'policy',
    risk: 'risk',
    vendor: 'vendor',
    framework: 'framework',
    finding: 'finding',
    integration: 'integration',
    trust: 'trust',
    pentest: 'pentest',
  },
  CommentEntityType: {
    task: 'task',
    vendor: 'vendor',
    risk: 'risk',
    policy: 'policy',
    finding: 'finding',
  },
  Prisma: {},
}));

describe('AdminVendorsController', () => {
  let controller: AdminVendorsController;

  const mockService = {
    findAllByOrganization: jest.fn(),
    triggerAssessment: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminVendorsController],
      providers: [{ provide: VendorsService, useValue: mockService }],
    }).compile();

    controller = module.get<AdminVendorsController>(AdminVendorsController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should list vendors for an organization', async () => {
      const vendors = [{ id: 'vnd_1', name: 'Acme' }];
      mockService.findAllByOrganization.mockResolvedValue(vendors);

      const result = await controller.list('org_1');

      expect(mockService.findAllByOrganization).toHaveBeenCalledWith('org_1');
      expect(result).toEqual(vendors);
    });
  });

  describe('create', () => {
    it('should create a vendor with required fields', async () => {
      const created = { id: 'vnd_new', name: 'New Vendor' };
      mockService.create.mockResolvedValue(created);

      const result = await controller.create(
        'org_1',
        { name: 'New Vendor', description: 'A test vendor' },
        { userId: 'usr_admin' },
      );

      expect(mockService.create).toHaveBeenCalledWith(
        'org_1',
        { name: 'New Vendor', description: 'A test vendor' },
        'usr_admin',
      );
      expect(result).toEqual(created);
    });

    it('should create a vendor with all optional fields', async () => {
      const created = { id: 'vnd_new', name: 'Full Vendor' };
      mockService.create.mockResolvedValue(created);

      const dto = {
        name: 'Full Vendor',
        description: 'Cloud provider',
        category: 'cloud_infrastructure' as never,
        status: 'not_assessed' as never,
        website: 'https://example.com',
      };

      const result = await controller.create('org_1', dto, {
        userId: 'usr_admin',
      });

      expect(mockService.create).toHaveBeenCalledWith(
        'org_1',
        dto,
        'usr_admin',
      );
      expect(result).toEqual(created);
    });
  });

  describe('triggerAssessment', () => {
    it('should trigger assessment for a vendor', async () => {
      const response = { runId: 'run_1', publicAccessToken: 'tok_1' };
      mockService.triggerAssessment.mockResolvedValue(response);

      const result = await controller.triggerAssessment('org_1', 'vnd_1', {
        userId: 'usr_admin',
      });

      expect(mockService.triggerAssessment).toHaveBeenCalledWith(
        'vnd_1',
        'org_1',
        'usr_admin',
      );
      expect(result).toEqual(response);
    });
  });
  describe('update', () => {
    it('should accept an active category and the classification arrays', async () => {
      const updated = { id: 'vnd_1' };
      mockService.updateById.mockResolvedValue(updated);

      const result = await controller.update('org_1', 'vnd_1', {
        category: 'data_enrichment',
        deliveryModels: ['saas', 'api_service'],
        dataServiceTypes: ['company_data', 'enrichment'],
        dataFlowRoles: ['processor', 'source'],
      });

      expect(mockService.updateById).toHaveBeenCalledWith('vnd_1', 'org_1', {
        category: 'data_enrichment',
        deliveryModels: ['saas', 'api_service'],
        dataServiceTypes: ['company_data', 'enrichment'],
        dataFlowRoles: ['processor', 'source'],
      });
      expect(result).toEqual(updated);
    });

    // The Prisma enum still contains these, so only this check keeps them out.
    it('should reject a retired category value', async () => {
      await expect(
        controller.update('org_1', 'vnd_1', {
          category: 'software_as_a_service',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockService.updateById).not.toHaveBeenCalled();
    });

    it('should reject an unknown value inside a classification array', async () => {
      await expect(
        controller.update('org_1', 'vnd_1', { dataFlowRoles: ['sink'] }),
      ).rejects.toThrow(BadRequestException);
      expect(mockService.updateById).not.toHaveBeenCalled();
    });

    it('should accept an empty classification array', async () => {
      mockService.updateById.mockResolvedValue({ id: 'vnd_1' });

      await controller.update('org_1', 'vnd_1', { dataServiceTypes: [] });

      expect(mockService.updateById).toHaveBeenCalledWith('vnd_1', 'org_1', {
        dataServiceTypes: [],
      });
    });

    it('should reject a body with no updatable field', async () => {
      await expect(controller.update('org_1', 'vnd_1', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
