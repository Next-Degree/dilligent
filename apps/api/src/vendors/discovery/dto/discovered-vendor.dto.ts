import { ApiPropertyOptional } from '@nestjs/swagger';
import { DiscoveredVendorStatus, VendorCategory } from '@db';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ListDiscoveredVendorsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by review status. Omit to return every candidate.',
    enum: DiscoveredVendorStatus,
  })
  @IsOptional()
  @IsEnum(DiscoveredVendorStatus)
  status?: DiscoveredVendorStatus;
}

export class ApproveDiscoveredVendorDto {
  @ApiPropertyOptional({
    description: 'Vendor name. Defaults to the resolved or observed application name.',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "Vendor website. Defaults to the resolved website." })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({
    description:
      'Vendor description. Defaults to the resolved description, or a generated one ' +
      'recording how and when the application was discovered.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Vendor category.', enum: VendorCategory })
  @IsOptional()
  @IsEnum(VendorCategory)
  category?: VendorCategory;
}

export class RescanDiscoveredVendorsDto {
  @ApiPropertyOptional({
    description: 'Connection to run discovery against.',
  })
  @IsString()
  connectionId!: string;
}

export class IgnoreDiscoveredVendorDto {
  @ApiPropertyOptional({
    description: 'Why this application is not a vendor worth tracking.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
