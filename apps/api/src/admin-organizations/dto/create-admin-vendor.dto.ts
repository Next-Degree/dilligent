import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsIn,
  IsArray,
  IsUrl,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { VendorStatus } from '@db';
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

export class CreateAdminVendorDto {
  @ApiProperty({
    description: 'Vendor name',
    example: 'CloudTech Solutions',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Description of the vendor and services',
    example: 'Cloud infrastructure provider for compute and storage',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({
    description:
      'What the vendor does for us. Exactly one functional category — never a delivery ' +
      'method: a hosted CRM is `sales`, not "SaaS".',
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

  @ApiProperty({
    description: 'Assessment status',
    enum: VendorStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;

  @ApiProperty({
    description: 'Vendor website URL',
    required: false,
    example: 'https://example.com',
  })
  @IsOptional()
  @IsUrl()
  @Transform(({ value }) => (value === '' ? undefined : value))
  website?: string;
}
