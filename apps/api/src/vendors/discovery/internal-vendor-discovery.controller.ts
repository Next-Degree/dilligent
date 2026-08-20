import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiExcludeController,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { OrganizationId } from '../../auth/auth-context.decorator';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequirePermission } from '../../auth/require-permission.decorator';
import { ServiceTokenOnlyGuard } from '../../auth/service-token-only.guard';
import { CheckResultsService } from '../../integration-platform/services/check-results.service';
import { VendorDiscoveryMaterializationService } from './vendor-discovery-materialization.service';

const DISCOVERY_CHECK_ID = 'oauth-app-access';

class MaterializeDiscoveryDto {
  @IsString()
  connectionId!: string;

  // Present so the trigger task can send it explicitly; the authenticated org still wins.
  @IsString()
  organizationId!: string;
}

/**
 * Internal endpoint that turns a completed discovery run into candidates and grants.
 *
 * Service-token only and excluded from the public API surface: this is the trigger task's
 * callback, not a customer-facing operation. Materialisation lives here rather than in the
 * task runtime so the trust predicate, resolution and writes have exactly one implementation.
 */
@ApiExcludeController()
@ApiTags('Internal - Vendors')
@Controller({ path: 'internal/vendor-discovery', version: '1' })
export class InternalVendorDiscoveryController {
  constructor(
    private readonly checkResults: CheckResultsService,
    private readonly materialization: VendorDiscoveryMaterializationService,
  ) {}

  @Post('materialize')
  @HttpCode(200)
  @UseGuards(HybridAuthGuard, ServiceTokenOnlyGuard, PermissionGuard)
  @RequirePermission('vendor', 'update')
  @ApiOperation({ summary: 'Materialise a discovery run into candidates and grants' })
  @ApiResponse({ status: 200, description: 'Materialisation summary' })
  async materialize(
    @OrganizationId() organizationId: string,
    @Body() body: MaterializeDiscoveryDto,
  ) {
    const rows = await this.checkResults.getLatestResultsByCheck({
      organizationId,
      connectionId: body.connectionId,
      checkId: DISCOVERY_CHECK_ID,
    });

    return this.materialization.materialize({ organizationId, rows });
  }
}
