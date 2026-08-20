import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
// Vendor discovery reads the output of an integration check, so it consumes the platform's
// universal CheckResultsService rather than querying check tables directly.
import { IntegrationPlatformModule } from '../integration-platform/integration-platform.module';
import { RisksModule } from '../risks/risks.module';
import { InternalVendorDiscoveryController } from './discovery/internal-vendor-discovery.controller';
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
  ],
  providers: [
    VendorsService,
    VendorResolutionService,
    VendorInferenceService,
    VendorDiscoveryMaterializationService,
  ],
  exports: [VendorsService, VendorDiscoveryMaterializationService],
})
export class VendorsModule {}
