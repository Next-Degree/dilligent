import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const INBOX_DEFAULT_LIMIT = 100;
export const INBOX_MAX_LIMIT = 250;

export class ListInboxQueryDto {
  @ApiPropertyOptional({
    description:
      'Maximum number of items to return, most urgent first. Each source contributes at most 50; `totals` reports the full count per kind.',
    example: INBOX_DEFAULT_LIMIT,
    default: INBOX_DEFAULT_LIMIT,
    minimum: 1,
    maximum: INBOX_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INBOX_MAX_LIMIT)
  limit?: number;
}
