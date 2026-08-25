import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrationPlatformModule } from '../integration-platform/integration-platform.module';
import { RisksModule } from '../risks/risks.module';
import { VendorIntegrationService } from './integration/vendor-integration.service';
import { VendorIntegrationsController } from './integration/vendor-integrations.controller';
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
    VendorIntegrationsController,
  ],
  providers: [VendorsService, VendorIntegrationService],
  exports: [VendorsService],
})
export class VendorsModule {}
