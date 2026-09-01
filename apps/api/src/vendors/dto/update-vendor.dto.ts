import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsIn,
  IsArray,
  IsUrl,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { VendorStatus, Likelihood, Impact, RiskTreatmentType } from '@db';
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

/**
 * DTO for PATCH /vendors/:id
 *
 * Defined explicitly rather than using PartialType(CreateVendorDto) because
 * PartialType preserves @IsNotEmpty() — which rejects empty strings even
 * when @IsOptional() is added. For PATCH, empty-string fields like
 * `description: ""` (common for vendors created during onboarding) should
 * not cause a 400.

 */
export class UpdateVendorDto extends VendorContractFieldsDto {
  @ApiPropertyOptional({ description: 'Vendor name' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ description: 'Vendor description' })
  @IsOptional()
  @IsString()
  description?: string;

  // Active vocabulary only — see the note in CreateVendorDto. A PATCH carrying a retired
  // value is how a stale client would otherwise re-introduce one.
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

  @ApiPropertyOptional({ description: 'Assessment status', enum: VendorStatus })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;

  @ApiPropertyOptional({
    description: 'Inherent probability',
    enum: Likelihood,
  })
  @IsOptional()
  @IsEnum(Likelihood)
  inherentProbability?: Likelihood;

  @ApiPropertyOptional({ description: 'Inherent impact', enum: Impact })
  @IsOptional()
  @IsEnum(Impact)
  inherentImpact?: Impact;

  @ApiPropertyOptional({
    description: 'Residual probability',
    enum: Likelihood,
  })
  @IsOptional()
  @IsEnum(Likelihood)
  residualProbability?: Likelihood;

  @ApiPropertyOptional({ description: 'Residual impact', enum: Impact })
  @IsOptional()
  @IsEnum(Impact)
  residualImpact?: Impact;

  @ApiPropertyOptional({
    description: 'Risk treatment strategy',
    enum: RiskTreatmentType,
    default: RiskTreatmentType.accept,
    example: RiskTreatmentType.mitigate,
  })
  @IsOptional()
  @IsEnum(RiskTreatmentType)
  treatmentStrategy?: RiskTreatmentType;

  @ApiPropertyOptional({
    description: 'Description of the treatment strategy',
    example: 'We isolated the vendor to a dedicated VPC.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  treatmentStrategyDescription?: string | null;

  @ApiPropertyOptional({ description: 'Vendor website URL' })
  @IsOptional()
  @IsUrl()
  @Transform(({ value }) => (value === '' ? undefined : value))
  website?: string;

  @ApiPropertyOptional({ description: 'Whether the vendor is a sub-processor' })
  @IsOptional()
  @IsBoolean()
  isSubProcessor?: boolean;

  @ApiPropertyOptional({ description: 'Assignee member ID' })
  @IsOptional()
  @IsString()
  assigneeId?: string;
}
