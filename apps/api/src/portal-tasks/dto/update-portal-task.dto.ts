import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { PortalTaskKindDto } from './create-portal-task.dto';

/**
 * Every field optional — this is a PATCH. `PartialType` is avoided on purpose:
 * the generated OpenAPI schema for mapped types loses the per-field examples
 * the MCP tool relies on.
 */
export class UpdatePortalTaskDto {
  @ApiPropertyOptional({
    description: 'Task title shown in the employee portal',
    example: 'Acknowledge the 2026 Code of Conduct',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description: 'Longer explanation shown when the task is expanded',
    example: 'Read the updated code of conduct and confirm you agree to it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    description:
      'acknowledgement: read and confirm. link: visit a URL, then confirm.',
    enum: PortalTaskKindDto,
    example: PortalTaskKindDto.link,
  })
  @IsOptional()
  @IsEnum(PortalTaskKindDto)
  kind?: PortalTaskKindDto;

  @ApiPropertyOptional({
    description: 'Destination for link tasks. Required when kind is link.',
    example: 'https://example.com/handbook',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  externalUrl?: string;

  @ApiPropertyOptional({
    description:
      'Wording the member agrees to. Snapshotted onto each completion record.',
    example: 'I have read and agree to the Code of Conduct.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  acknowledgementText?: string;

  @ApiPropertyOptional({
    description: 'Publish to the portal, or unpublish back to draft',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({
    description:
      'Optional tasks show in the portal but do not block completion',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({
    description:
      'Archive or restore the task. Archived tasks leave the portal.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional({
    description: 'Sort order in the portal task list, ascending',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  order?: number;
}
