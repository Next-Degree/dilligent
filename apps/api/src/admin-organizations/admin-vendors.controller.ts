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
import { VendorStatus } from '@db';
import {
  isActiveVendorCategory,
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { VendorsService } from '../vendors/vendors.service';
import { AdminAuditLogInterceptor } from './admin-audit-log.interceptor';
import { CreateAdminVendorDto } from './dto/create-admin-vendor.dto';
import type { AdminRequest } from './platform-admin-auth-context';

interface UpdateVendorBody {
  status?: string;
  category?: string;
  deliveryModels?: string[];
  dataServiceTypes?: string[];
  dataFlowRoles?: string[];
}

/**
 * This endpoint takes a raw body rather than a DTO, so every value is checked here.
 * Array.isArray is not redundant with the declared type: nothing validates the body
 * before it reaches us.
 */
function checkedList({
  field,
  values,
  allowed,
}: {
  field: string;
  values: string[];
  allowed: readonly string[];
}): string[] {
  if (!Array.isArray(values) || values.some((value) => !allowed.includes(value))) {
    throw new BadRequestException(
      `Invalid ${field}. Each value must be one of: ${allowed.join(', ')}`,
    );
  }
  return values;
}

@ApiExcludeController()
@ApiTags('Admin - Vendors')
@Controller({ path: 'admin/organizations', version: '1' })
@UseGuards(PlatformAdminGuard)
@UseInterceptors(AdminAuditLogInterceptor)
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
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
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
    @Body() body: UpdateVendorBody,
  ) {
    const updateData: Record<string, unknown> = {};

    if (body.status !== undefined) {
      if (!Object.values(VendorStatus).includes(body.status as VendorStatus)) {
        throw new BadRequestException(
          `Invalid status. Must be one of: ${Object.values(VendorStatus).join(', ')}`,
        );
      }
      updateData.status = body.status as VendorStatus;
    }

    // The Prisma enum still carries retired values for rolling-deploy safety, so it is
    // not the allow-list — writing one back would undo the backfill.
    if (body.category !== undefined) {
      if (!isActiveVendorCategory(body.category)) {
        throw new BadRequestException(
          `Invalid category. Must be one of: ${VENDOR_CATEGORIES.join(', ')}`,
        );
      }
      updateData.category = body.category;
    }

    if (body.deliveryModels !== undefined) {
      updateData.deliveryModels = checkedList({
        field: 'deliveryModels',
        values: body.deliveryModels,
        allowed: VENDOR_DELIVERY_MODELS,
      });
    }

    if (body.dataServiceTypes !== undefined) {
      updateData.dataServiceTypes = checkedList({
        field: 'dataServiceTypes',
        values: body.dataServiceTypes,
        allowed: DATA_SERVICE_TYPES,
      });
    }

    if (body.dataFlowRoles !== undefined) {
      updateData.dataFlowRoles = checkedList({
        field: 'dataFlowRoles',
        values: body.dataFlowRoles,
        allowed: DATA_FLOW_ROLES,
      });
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException(
        'At least one field (status, category, deliveryModels, dataServiceTypes, ' +
          'dataFlowRoles) is required',
      );
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
