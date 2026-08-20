import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsOptional,
  IsBoolean,
  IsString,
  IsEmail,
  IsDateString,
  IsIn,
  MaxLength,
} from 'class-validator';
import { CreatePeopleDto } from './create-people.dto';
import {
  EXTERNAL_USER_SOURCES,
  type ExternalUserSource,
} from '../utils/external-identity';

export class UpdatePeopleDto extends PartialType(CreatePeopleDto) {
  @ApiProperty({
    description: 'Whether to deactivate this member (soft delete)',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    description: 'Name of the associated user',
    example: 'John Doe',
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: 'Email of the associated user',
    example: 'john@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    description: 'Member join date (createdAt override)',
    example: '2024-01-15T00:00:00.000Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  createdAt?: string;

  @ApiProperty({
    description:
      'When true, this member is exempt from the org-level background check requirement and will count as complete in people scores.',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  backgroundCheckExempt?: boolean;

  @ApiProperty({
    description:
      'Reason code for the exemption (e.g. "contractor_with_vendor_check", "other"). Persisted alongside backgroundCheckExempt and cleared when the member becomes non-exempt.',
    example: 'other',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  backgroundCheckExemptReason?: string;

  @ApiProperty({
    description:
      'Free-text justification for the exemption, attached to the audit log. Cleared when the member becomes non-exempt.',
    example: 'Contractor with existing background check on file from staffing agency.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  backgroundCheckExemptJustification?: string;

  @ApiProperty({
    description: 'Employee onboard date',
    example: '2026-01-15T00:00:00.000Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  onboardDate?: string | null;

  @ApiProperty({
    description: 'Employee offboard date',
    example: '2026-04-30T00:00:00.000Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  offboardDate?: string | null;

  @ApiProperty({
    description:
      'Provider the linked account belongs to. Paired with externalUserId: send both together, or both null to unlink.',
    example: 'github',
    enum: EXTERNAL_USER_SOURCES,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsIn(EXTERNAL_USER_SOURCES)
  externalUserSource?: ExternalUserSource | null;

  @ApiProperty({
    description:
      'Email this member uses on the linked provider. Employee Access checks match it in addition to the login email, so a personal account still resolves to this person.',
    example: 'jane@personal.example',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsEmail()
  externalUserId?: string | null;
}
