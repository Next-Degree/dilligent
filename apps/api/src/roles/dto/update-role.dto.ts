import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { BuiltInObligationsBody } from './update-built-in-obligations.dto';

export class UpdateRoleDto {
  @ApiProperty({
    description: 'New name for the custom role',
    example: 'Compliance Manager',
    minLength: 2,
    maxLength: 50,
    required: false,
  })
  // Trim so a trailing space can't create a name that never matches a
  // trimmed role in member.role.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z][a-zA-Z0-9\s-]*$/, {
    message:
      'Role name must start with a letter and contain only letters, numbers, spaces, and hyphens',
  })
  name?: string;

  @ApiProperty({
    description:
      'Updated permissions for the role. Keys are resource names, values are arrays of allowed actions.',
    example: {
      control: ['read', 'update', 'delete'],
      policy: ['read', 'update', 'delete'],
      risk: ['read', 'update'],
    },
    required: false,
  })
  @IsObject()
  @IsOptional()
  permissions?: Record<string, string[]>;

  @ApiProperty({
    description: 'Updated obligations for the role.',
    example: { compliance: true },
    required: false,
    type: BuiltInObligationsBody,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BuiltInObligationsBody)
  obligations?: BuiltInObligationsBody;
}
