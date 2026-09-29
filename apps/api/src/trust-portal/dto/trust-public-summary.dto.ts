import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class TrustPublicCertificationDto {
  @ApiProperty({
    description: 'Framework key, e.g. soc2_type2, iso_27001, gdpr, hipaa',
    example: 'soc2_type2',
  })
  framework!: string;

  @ApiProperty({
    description: 'Progress towards the framework',
    enum: ['started', 'in_progress', 'compliant'],
    example: 'compliant',
  })
  status!: 'started' | 'in_progress' | 'compliant';
}

export class TrustPublicPolicyDto {
  @ApiProperty({ example: 'pol_123' })
  id!: string;

  @ApiProperty({ example: 'Acceptable Use Policy' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;
}

export class TrustPublicControlDto {
  @ApiProperty({ example: 'ctl_123' })
  id!: string;

  @ApiProperty({ example: 'Access Rights Management' })
  name!: string;
}

export class TrustPublicStatsDto {
  @ApiProperty({ example: 14 })
  policies!: number;

  @ApiProperty({ example: 5 })
  frameworks!: number;

  @ApiProperty({ example: 44 })
  controls!: number;

  @ApiProperty({ example: 6 })
  subprocessors!: number;
}

export class TrustPublicSummaryDto {
  @ApiProperty({ example: 'acme' })
  friendlyUrl!: string;

  @ApiProperty({ example: 'Acme Inc.' })
  organizationName!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Signed URL of the organization logo (expires)',
  })
  logoUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Signed URL of the trust portal favicon (expires)',
  })
  faviconUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '#0f766e' })
  primaryColor!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'https://acme.com' })
  website!: string | null;

  @ApiProperty({ type: [TrustPublicCertificationDto] })
  certifications!: TrustPublicCertificationDto[];

  @ApiProperty({ type: TrustPublicStatsDto })
  stats!: TrustPublicStatsDto;

  @ApiProperty({ type: [TrustPublicPolicyDto] })
  policies!: TrustPublicPolicyDto[];

  @ApiProperty({ type: [TrustPublicControlDto] })
  controls!: TrustPublicControlDto[];
}

export class ResolveTrustDomainQueryDto {
  @ApiProperty({
    description: 'Custom domain the trust portal is served from',
    example: 'security.acme.com',
  })
  @IsString()
  @IsNotEmpty()
  domain!: string;
}

export class ResolveTrustDomainResponseDto {
  @ApiProperty({ example: 'acme' })
  friendlyUrl!: string;
}
