import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUrl,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { VendorStatus, Likelihood, Impact, RiskTreatmentType } from '@db';
import { VendorClassificationFieldsDto } from './vendor-classification-fields.dto';
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
export class UpdateVendorDto extends IntersectionType(
  VendorContractFieldsDto,
  VendorClassificationFieldsDto,
) {
  @ApiPropertyOptional({ description: 'Vendor name' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ description: 'Vendor description' })
  @IsOptional()
  @IsString()
  description?: string;

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
