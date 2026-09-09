import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUrl,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { VendorStatus } from '@db';
import { VendorClassificationFieldsDto } from '../../vendors/dto/vendor-classification-fields.dto';

export class CreateAdminVendorDto extends VendorClassificationFieldsDto {
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
