import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsIn,
  IsDateString,
  IsISO31661Alpha2,
  MaxLength,
} from 'class-validator';
import { Departments } from '@db';
import { DEPARTMENT_MAX_LENGTH } from '../../policies/dto/create-policy.dto';
import {
  EMPLOYMENT_TYPES,
  type EmploymentTypeValue,
} from '../utils/employment';

export class CreatePeopleDto {
  @ApiProperty({
    description: 'User ID to associate with this member',
    example: 'usr_abc123def456',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Role for the member (built-in role name or custom role ID)',
    example: 'admin',
  })
  @IsString()
  @IsNotEmpty()
  role: string;

  @ApiProperty({
    description:
      'Member department. Built-in values: none, admin, gov, hr, it, itsm, qms. Custom department names are also accepted.',
    example: Departments.it,
    required: false,
    type: 'string',
    maxLength: DEPARTMENT_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(DEPARTMENT_MAX_LENGTH)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  department?: string;

  @ApiProperty({
    description: 'Whether member is active',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    description: 'FleetDM label ID for member devices',
    example: 123,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  fleetDmLabelId?: number;

  @ApiProperty({
    description: 'Job title for the member',
    example: 'Software Engineer',
    required: false,
  })
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @ApiProperty({
    description:
      'Employment type for the member. Contract members must also carry a contractExpiryDate.',
    enum: EMPLOYMENT_TYPES,
    example: 'permanent',
    required: false,
  })
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: EmploymentTypeValue;

  @ApiProperty({
    description:
      'Date the member\'s contract expires. Required when employmentType is "contract", and rejected for permanent members.',
    example: '2026-12-31T00:00:00.000Z',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  contractExpiryDate?: string | null;

  @ApiProperty({
    description:
      "The member's primary work location, as an ISO 3166-1 alpha-2 country code (e.g. US, GB, BR). Send null to clear it.",
    example: 'US',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsISO31661Alpha2()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  primaryLocation?: string | null;
}
