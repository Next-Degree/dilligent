jest.mock('../auth/auth.module', () => ({ AuthModule: class AuthModule {} }));
jest.mock('../integration-platform/integration-platform.module', () => ({
  IntegrationPlatformModule: class IntegrationPlatformModule {},
}));
jest.mock('../risks/risks.module', () => ({
  RisksModule: class RisksModule {},
}));
jest.mock('./vendors.controller', () => ({
  VendorsController: class VendorsController {},
}));
jest.mock('./discovery/discovered-vendors.controller', () => ({
  DiscoveredVendorsController: class DiscoveredVendorsController {},
}));
jest.mock('./discovery/internal-vendor-discovery.controller', () => ({
  InternalVendorDiscoveryController: class InternalVendorDiscoveryController {},
}));
jest.mock('./discovery/vendor-access.controller', () => ({
  VendorAccessController: class VendorAccessController {},
}));
jest.mock('./integration/vendor-integrations.controller', () => ({
  VendorIntegrationsController: class VendorIntegrationsController {},
}));
jest.mock('./internal-vendor-automation.controller', () => ({
  InternalVendorAutomationController: class InternalVendorAutomationController {},
}));
jest.mock('./vendor-acceptances.controller', () => ({
  VendorAcceptancesController: class VendorAcceptancesController {},
}));
jest.mock('./vendors.service', () => ({
  VendorsService: class VendorsService {},
}));
jest.mock('./discovery/discovered-vendors.service', () => ({
  DiscoveredVendorsService: class DiscoveredVendorsService {},
}));
jest.mock('./discovery/vendor-access.service', () => ({
  VendorAccessService: class VendorAccessService {},
}));
jest.mock('./discovery/vendor-discovery-materialization.service', () => ({
  VendorDiscoveryMaterializationService: class VendorDiscoveryMaterializationService {},
}));
jest.mock('./discovery/vendor-inference.service', () => ({
  VendorInferenceService: class VendorInferenceService {},
}));
jest.mock('./discovery/vendor-resolution.service', () => ({
  VendorResolutionService: class VendorResolutionService {},
}));
jest.mock('./integration/vendor-integration.service', () => ({
  VendorIntegrationService: class VendorIntegrationService {},
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { DiscoveredVendorsController } from './discovery/discovered-vendors.controller';
import { VendorsController } from './vendors.controller';
import { VendorsModule } from './vendors.module';

describe('VendorsModule routing', () => {
  it('registers the static discovery routes before the dynamic vendor ID route', () => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      VendorsModule,
    );

    expect(Array.isArray(controllers)).toBe(true);
    if (!Array.isArray(controllers)) {
      throw new Error('VendorsModule controller metadata is missing');
    }

    const discoveredIndex = controllers.indexOf(DiscoveredVendorsController);
    const vendorsIndex = controllers.indexOf(VendorsController);

    expect(discoveredIndex).toBeGreaterThanOrEqual(0);
    expect(vendorsIndex).toBeGreaterThanOrEqual(0);
    expect(discoveredIndex).toBeLessThan(vendorsIndex);
  });
});
