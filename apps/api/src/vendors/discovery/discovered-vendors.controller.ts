import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { tasks } from '@trigger.dev/sdk';
import { ActingUserResolver } from '../../auth/acting-user.service';
import { AuthContext, OrganizationId } from '../../auth/auth-context.decorator';
import type {
  AuthContext as AuthContextType,
  AuthenticatedRequest,
} from '../../auth/types';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequirePermission } from '../../auth/require-permission.decorator';
import { DiscoveredVendorsService } from './discovered-vendors.service';
import {
  ApproveDiscoveredVendorDto,
  IgnoreDiscoveredVendorDto,
  ListDiscoveredVendorsQueryDto,
  RescanDiscoveredVendorsDto,
} from './dto/discovered-vendor.dto';

/**
 * Review queue for third-party applications discovered through integrations.
 *
 * Governed by the existing vendor permissions rather than a new resource: a candidate is a
 * prospective vendor, and approving one creates a vendor.
 */
@ApiTags('Vendors')
@Controller({ path: 'vendors/discovered', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class DiscoveredVendorsController {
  constructor(
    private readonly discoveredVendors: DiscoveredVendorsService,
    private readonly actingUser: ActingUserResolver,
  ) {}

  private envelope(authContext: AuthContextType) {
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

  @Get()
  @RequirePermission('vendor', 'read')
  @ApiOperation({ summary: 'List discovered third-party applications' })
  async list(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
    @Query() query: ListDiscoveredVendorsQueryDto,
  ) {
    const data = await this.discoveredVendors.list({
      organizationId,
      status: query.status,
    });

    return { data, count: data.length, ...this.envelope(authContext) };
  }

  @Get('pending-count')
  @RequirePermission('vendor', 'read')
  @ApiOperation({ summary: 'Count applications awaiting review' })
  async pendingCount(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const count = await this.discoveredVendors.countPending(organizationId);
    return { count, ...this.envelope(authContext) };
  }

  @Get(':id')
  @RequirePermission('vendor', 'read')
  @ApiOperation({ summary: 'Get a discovered application and who holds access to it' })
  async findOne(
    @Param('id') candidateId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const candidate = await this.discoveredVendors.findOne({
      organizationId,
      candidateId,
    });
    return { ...candidate, ...this.envelope(authContext) };
  }

  @Post(':id/approve')
  @RequirePermission('vendor', 'create')
  @ApiOperation({ summary: 'Approve a discovered application into a vendor' })
  async approve(
    @Param('id') candidateId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
    @Body() body: ApproveDiscoveredVendorDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // Approval creates a vendor and triggers its risk assessment, both of which are
    // attributed. API-key and service-token callers resolve to the key's creator rather
    // than defaulting the credit to the org owner.
    const acting = await this.actingUser.resolve(req, organizationId);
    if (!acting.userId) {
      throw new BadRequestException(
        'Cannot attribute this action — your organization must have at least one active user with the "owner" role.',
      );
    }

    const result = await this.discoveredVendors.approve({
      organizationId,
      candidateId,
      actingUserId: acting.userId,
      ...body,
    });

    return { ...result, ...this.envelope(authContext) };
  }

  @Post(':id/ignore')
  @RequirePermission('vendor', 'update')
  @ApiOperation({ summary: 'Remove a discovered application from the review queue' })
  async ignore(
    @Param('id') candidateId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
    @Body() body: IgnoreDiscoveredVendorDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const acting = await this.actingUser.resolve(req, organizationId);
    const candidate = await this.discoveredVendors.ignore({
      organizationId,
      candidateId,
      actingUserId: acting.userId ?? null,
      reason: body.reason,
    });

    return { ...candidate, ...this.envelope(authContext) };
  }

  @Post(':id/reopen')
  @RequirePermission('vendor', 'update')
  @ApiOperation({ summary: 'Return an ignored application to the review queue' })
  async reopen(
    @Param('id') candidateId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
    @Req() req: AuthenticatedRequest,
  ) {
    const acting = await this.actingUser.resolve(req, organizationId);
    const candidate = await this.discoveredVendors.reopen({
      organizationId,
      candidateId,
      actingUserId: acting.userId ?? null,
    });

    return { ...candidate, ...this.envelope(authContext) };
  }

  @Post('rescan')
  @RequirePermission('vendor', 'update')
  @ApiOperation({ summary: 'Run discovery now rather than waiting for the daily schedule' })
  async rescan(
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
    @Body() body: RescanDiscoveredVendorsDto,
  ) {
    const handle = await tasks.trigger('run-vendor-discovery', {
      connectionId: body.connectionId,
      organizationId,
    });

    return { triggered: true, runId: handle.id, ...this.envelope(authContext) };
  }
}
