import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsIn,
  IsArray,
  IsUrl,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { VendorStatus, Likelihood, Impact } from '@db';
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
import { VendorContractFieldsDto } from './vendor-contract-fields.dto';

export class CreateVendorDto extends VendorContractFieldsDto {
  @ApiProperty({
    description: 'Vendor name',
    example: 'CloudTech Solutions Inc.',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Detailed description of the vendor and services provided',
    example:
      'Cloud infrastructure provider offering AWS-like services including compute, storage, and networking solutions for enterprise customers.',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  // Validated against the ACTIVE vocabulary rather than the Prisma enum: the Postgres
  // type still carries retired values so a rolling deploy cannot fail, and nothing new
  // may be written with one.
  @ApiProperty({
    description:
      'What the vendor does for us. Exactly one functional category — never a delivery ' +
      'method: a hosted CRM is `sales`, not "SaaS".',
    enum: VENDOR_CATEGORIES,
    default: 'other',
    example: 'cloud_infrastructure',
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
    example: ['saas'],
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
    example: ['company_data', 'enrichment'],
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
    example: ['processor', 'source'],
  })
  @IsOptional()
  @IsArray()
  @IsIn([...DATA_FLOW_ROLES], { each: true })
  dataFlowRoles?: DataFlowRoleValue[];

  @ApiProperty({
    description: 'Assessment status of the vendor',
    enum: VendorStatus,
    default: VendorStatus.not_assessed,
    example: VendorStatus.not_assessed,
  })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;

  @ApiProperty({
    description: 'Inherent probability of risk before controls',
    enum: Likelihood,
    default: Likelihood.very_unlikely,
    example: Likelihood.possible,
  })
  @IsOptional()
  @IsEnum(Likelihood)
  inherentProbability?: Likelihood;

  @ApiProperty({
    description: 'Inherent impact of risk before controls',
    enum: Impact,
    default: Impact.insignificant,
    example: Impact.moderate,
  })
  @IsOptional()
  @IsEnum(Impact)
  inherentImpact?: Impact;

  @ApiProperty({
    description: 'Residual probability after controls are applied',
    enum: Likelihood,
    default: Likelihood.very_unlikely,
    example: Likelihood.unlikely,
  })
  @IsOptional()
  @IsEnum(Likelihood)
  residualProbability?: Likelihood;

  @ApiProperty({
    description: 'Residual impact after controls are applied',
    enum: Impact,
    default: Impact.insignificant,
    example: Impact.minor,
  })
  @IsOptional()
  @IsEnum(Impact)
  residualImpact?: Impact;

  @ApiProperty({
    description: 'Vendor website URL',
    required: false,
    example: 'https://www.cloudtechsolutions.com',
  })
  @IsOptional()
  @IsUrl()
  @Transform(({ value }) => (value === '' ? undefined : value))
  website?: string;

  @ApiProperty({
    description: 'Whether the vendor is a sub-processor',
    default: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isSubProcessor?: boolean;

  @ApiProperty({
    description: 'ID of the user assigned to manage this vendor',
    required: false,
    example: 'mem_abc123def456',
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;
}
