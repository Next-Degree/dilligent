import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { VendorsService } from '../vendors/vendors.service';
import { AdminAuditLogInterceptor } from './admin-audit-log.interceptor';
import { CreateAdminVendorDto } from './dto/create-admin-vendor.dto';
import { UpdateAdminVendorDto } from './dto/update-admin-vendor.dto';
import type { AdminRequest } from './platform-admin-auth-context';

@ApiExcludeController()
@ApiTags('Admin - Vendors')
@Controller({ path: 'admin/organizations', version: '1' })
@UseGuards(PlatformAdminGuard)
@UseInterceptors(AdminAuditLogInterceptor)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Throttle({ default: { ttl: 60000, limit: 30 } })
export class AdminVendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get(':orgId/vendors')
  @ApiOperation({ summary: 'List all vendors for an organization (admin)' })
  async list(@Param('orgId') orgId: string) {
    return this.vendorsService.findAllByOrganization(orgId);
  }

  @Post(':orgId/vendors')
  @ApiOperation({ summary: 'Create a vendor for an organization (admin)' })
  async create(
    @Param('orgId') orgId: string,
    @Body() createDto: CreateAdminVendorDto,
    @Req() req: AdminRequest,
  ) {
    return this.vendorsService.create(orgId, createDto, req.userId);
  }

  @Patch(':orgId/vendors/:vendorId')
  @ApiOperation({ summary: 'Update a vendor for an organization (admin)' })
  async update(
    @Param('orgId') orgId: string,
    @Param('vendorId') vendorId: string,
    @Body() body: UpdateAdminVendorDto,
  ) {
    // Only the fields the caller actually sent: a PATCH must not blank a column the
    // body never mentioned. Values are already validated by the DTO.
    const updateData: Record<string, unknown> = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('At least one field is required');
    }

    return this.vendorsService.updateById(vendorId, orgId, updateData);
  }

  @Post(':orgId/vendors/:vendorId/trigger-assessment')
  @ApiOperation({ summary: 'Trigger vendor risk assessment (admin)' })
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async triggerAssessment(
    @Param('orgId') orgId: string,
    @Param('vendorId') vendorId: string,
    @Req() req: AdminRequest,
  ) {
    return this.vendorsService.triggerAssessment(vendorId, orgId, req.userId);
  }
}
