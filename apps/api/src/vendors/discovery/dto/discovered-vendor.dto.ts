import { ApiPropertyOptional } from '@nestjs/swagger';
import { DiscoveredVendorStatus } from '@db';
import { IsArray, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
  type DataFlowRoleValue,
  type DataServiceTypeValue,
  type VendorCategoryValue,
  type VendorDeliveryModelValue,
} from '@trycompai/utils/vendors';

export class ListDiscoveredVendorsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by review status. Omit to return every candidate.',
    enum: DiscoveredVendorStatus,
  })
  @IsOptional()
  @IsEnum(DiscoveredVendorStatus)
  status?: DiscoveredVendorStatus;
}

export class ApproveDiscoveredVendorDto {
  @ApiPropertyOptional({
    description: 'Vendor name. Defaults to the resolved or observed application name.',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "Vendor website. Defaults to the resolved website." })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({
    description:
      'Vendor description. Defaults to the resolved description, or a generated one ' +
      'recording how and when the application was discovered.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'What the vendor does for us. Defaults to the inferred category, or `other`. ' +
      'Never a delivery method — a hosted CRM is `sales`, not "SaaS".',
    enum: VENDOR_CATEGORIES,
  })
  @IsOptional()
  @IsIn([...VENDOR_CATEGORIES])
  category?: VendorCategoryValue;

  @ApiPropertyOptional({
    description:
      'How we consume the vendor. Independent of what it does, and the signal that ' +
      'decides whether the workload runs outside our perimeter.',
    enum: VENDOR_DELIVERY_MODELS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn([...VENDOR_DELIVERY_MODELS], { each: true })
  deliveryModels?: VendorDeliveryModelValue[];

  @ApiPropertyOptional({
    description:
      'What data the vendor deals in, for vendors whose product is data. Empty for a ' +
      'vendor that merely stores data we type into it.',
    enum: DATA_SERVICE_TYPES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn([...DATA_SERVICE_TYPES], { each: true })
  dataServiceTypes?: DataServiceTypeValue[];

  @ApiPropertyOptional({
    description:
      'Where the vendor sits in our data flow. Empty when no meaningful data crosses ' +
      'the boundary; a vendor may hold several roles at once.',
    enum: DATA_FLOW_ROLES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn([...DATA_FLOW_ROLES], { each: true })
  dataFlowRoles?: DataFlowRoleValue[];
}

export class RescanDiscoveredVendorsDto {
  @ApiPropertyOptional({
    description: 'Connection to run discovery against.',
  })
  @IsString()
  connectionId!: string;
}

export class IgnoreDiscoveredVendorDto {
  @ApiPropertyOptional({
    description: 'Why this application is not a vendor worth tracking.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
