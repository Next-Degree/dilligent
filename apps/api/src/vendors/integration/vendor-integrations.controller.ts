import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthContext, OrganizationId } from '../../auth/auth-context.decorator';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequirePermission } from '../../auth/require-permission.decorator';
import type { AuthContext as AuthContextType } from '../../auth/types';
import { GET_VENDOR_INTEGRATION_RESPONSES } from '../schemas/get-vendor-integration.responses';
import { LIST_VENDOR_INTEGRATIONS_RESPONSES } from '../schemas/list-vendor-integrations.responses';
import { VendorIntegrationService } from './vendor-integration.service';

/** The authenticated-caller envelope every vendor endpoint returns. */
function withAuth(authContext: AuthContextType) {
  return {
    authType: authContext.authType,
    ...(authContext.userId &&
      authContext.userEmail && {
        authenticatedUser: {
          id: authContext.userId,
          email: authContext.userEmail,
        },
      }),
  };
}

/**
 * Vendor <-> integration links.
 *
 * Mounted off `/v1/vendor-integrations` rather than under `/v1/vendors/...` so
 * these routes can never be swallowed by the `GET /v1/vendors/:id` wildcard.
 */
@ApiTags('Vendors')
@Controller({ path: 'vendor-integrations', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class VendorIntegrationsController {
  constructor(
    private readonly vendorIntegrationService: VendorIntegrationService,
  ) {}

  @Get()
  @RequirePermission('vendor', 'read')
  @ApiOperation({
    summary: 'List vendor integration links',
    description:
      'Lists which vendors match an integration in the catalog and whether that integration is connected, so vendor risk views can show live third-party monitoring coverage. Vendors matching no integration are omitted.',
  })
  @ApiResponse(LIST_VENDOR_INTEGRATIONS_RESPONSES[200])
  @ApiResponse(LIST_VENDOR_INTEGRATIONS_RESPONSES[401])
  @ApiResponse(LIST_VENDOR_INTEGRATIONS_RESPONSES[500])
  async listVendorIntegrations(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const links = await this.vendorIntegrationService.listLinks(organizationId);

    return {
      data: links,
      count: links.length,
      ...withAuth(authContext),
    };
  }

  @Get(':vendorId')
  @RequirePermission('vendor', 'read')
  @ApiOperation({
    summary: 'Get vendor integration detail',
    description:
      'Returns the integration linked to a vendor with its compliance checks and the people those access checks report, joined to organization members. Checks and users are empty unless the integration is connected.',
  })
  @ApiParam({ name: 'vendorId', description: 'Vendor ID' })
  @ApiResponse(GET_VENDOR_INTEGRATION_RESPONSES[200])
  @ApiResponse(GET_VENDOR_INTEGRATION_RESPONSES[401])
  @ApiResponse(GET_VENDOR_INTEGRATION_RESPONSES[404])
  @ApiResponse(GET_VENDOR_INTEGRATION_RESPONSES[500])
  async getVendorIntegration(
    @Param('vendorId') vendorId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const detail = await this.vendorIntegrationService.getForVendor(
      vendorId,
      organizationId,
    );

    return {
      ...detail,
      ...withAuth(authContext),
    };
  }
}
