import { ApiPropertyOptional } from '@nestjs/swagger';
import { VendorStatus } from '@db';
import { IsEnum, IsOptional } from 'class-validator';
import { VendorClassificationFieldsDto } from '../../vendors/dto/vendor-classification-fields.dto';

/**
 * Body for the admin vendor PATCH. Every field is optional, so the controller still
 * has to reject a body that sets none of them — that is the one rule the
 * ValidationPipe cannot express.
 */
export class UpdateAdminVendorDto extends VendorClassificationFieldsDto {
  @ApiPropertyOptional({
    description: 'Assessment status',
    enum: VendorStatus,
  })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;
}
