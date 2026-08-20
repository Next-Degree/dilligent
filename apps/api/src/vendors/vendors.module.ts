import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
// Vendor discovery reads the output of an integration check, so it consumes the platform's
// universal CheckResultsService rather than querying check tables directly.
import { IntegrationPlatformModule } from '../integration-platform/integration-platform.module';
import { RisksModule } from '../risks/risks.module';
import { DiscoveredVendorsController } from './discovery/discovered-vendors.controller';
import { DiscoveredVendorsService } from './discovery/discovered-vendors.service';
import { InternalVendorDiscoveryController } from './discovery/internal-vendor-discovery.controller';
import { VendorAccessController } from './discovery/vendor-access.controller';
import { VendorAccessService } from './discovery/vendor-access.service';
import { VendorDiscoveryMaterializationService } from './discovery/vendor-discovery-materialization.service';
import { VendorInferenceService } from './discovery/vendor-inference.service';
import { VendorResolutionService } from './discovery/vendor-resolution.service';
import { InternalVendorAutomationController } from './internal-vendor-automation.controller';
import { VendorAcceptancesController } from './vendor-acceptances.controller';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  imports: [AuthModule, RisksModule, IntegrationPlatformModule],
  controllers: [
    VendorsController,
    VendorAcceptancesController,
    InternalVendorAutomationController,
    InternalVendorDiscoveryController,
    DiscoveredVendorsController,
    VendorAccessController,
  ],
  providers: [
    VendorsService,
    VendorResolutionService,
    VendorInferenceService,
    VendorDiscoveryMaterializationService,
    DiscoveredVendorsService,
    VendorAccessService,
  ],
  exports: [
    VendorsService,
    VendorDiscoveryMaterializationService,
    VendorAccessService,
  ],
})
export class VendorsModule {}
