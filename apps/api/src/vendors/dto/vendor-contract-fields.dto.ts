import { ApiPropertyOptional } from '@nestjs/swagger';
import { VendorContractTerm } from '@db';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const MAX_SEATS = 10_000_000;
const MAX_ANNUAL_COST_CENTS = 2_000_000_000;
const MAX_NOTICE_PERIOD_DAYS = 3650;

export class VendorContractFieldsDto {
  @ApiPropertyOptional({
    description: 'Seats included in the contract',
    type: Number,
    nullable: true,
    example: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEATS)
  totalSeats?: number | null;

  @ApiPropertyOptional({
    description: 'Seats currently in use',
    type: Number,
    nullable: true,
    example: 42,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEATS)
  usedSeats?: number | null;

  @ApiPropertyOptional({
    description: 'Date the contract renews, ISO 8601',
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2027-01-31T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  renewalDate?: string | null;

  @ApiPropertyOptional({
    description: 'Annual contract cost in USD cents (e.g. 1200000 = $12,000)',
    type: Number,
    nullable: true,
    example: 1200000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ANNUAL_COST_CENTS)
  annualCostCents?: number | null;

  @ApiPropertyOptional({
    description: 'Whether the contract is billed monthly or yearly',
    enum: VendorContractTerm,
    nullable: true,
    example: VendorContractTerm.yearly,
  })
  @IsOptional()
  @IsEnum(VendorContractTerm)
  contractTerm?: VendorContractTerm | null;

  @ApiPropertyOptional({
    description:
      'Days of notice the contract requires before cancellation, capped at 3650 (10 years)',
    type: Number,
    nullable: true,
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_NOTICE_PERIOD_DAYS)
  noticePeriodDays?: number | null;

  @ApiPropertyOptional({
    description:
      'Member ID of the internal person in charge of running this system day to day. Distinct from assigneeId, the IT or compliance member running the risk assessment.',
    type: String,
    nullable: true,
    example: 'mem_abc123def456',
  })
  @IsOptional()
  @IsString()
  ownerId?: string | null;
}
