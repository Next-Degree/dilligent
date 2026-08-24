import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { MemberId, OrganizationId } from '../auth/auth-context.decorator';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreatePortalTaskDto } from './dto/create-portal-task.dto';
import { UpdatePortalTaskDto } from './dto/update-portal-task.dto';
import { PortalTasksService } from './portal-tasks.service';

@ApiTags('Portal Tasks')
@Controller({ path: 'portal-tasks', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class PortalTasksController {
  constructor(private readonly portalTasksService: PortalTasksService) {}

  // Declared before the `:id` routes so the literal path always wins.
  @Get('assigned')
  @RequirePermission('portal', 'read')
  @ApiOperation({
    summary: 'List my portal tasks',
    description:
      'Returns the published portal tasks assigned to the authenticated member, each with their completion timestamp or null when still outstanding.',
  })
  @ApiResponse({ status: 200, description: 'Portal tasks for this member' })
  async listAssigned(
    @MemberId() memberId: string | undefined,
    @OrganizationId() organizationId: string,
  ) {
    if (!memberId) {
      throw new BadRequestException('Session authentication required');
    }

    return this.portalTasksService.listAssigned(organizationId, memberId);
  }

  @Get()
  @RequirePermission('task', 'read')
  @ApiOperation({
    summary: 'List portal tasks',
    description:
      "Returns the organization's custom employee portal tasks with completion progress, so administrators can see how many people still owe each acknowledgement.",
  })
  @ApiQuery({
    name: 'includeArchived',
    required: false,
    type: Boolean,
    description: 'Include archived tasks in the response',
  })
  @ApiResponse({
    status: 200,
    description: 'Portal tasks with progress counts',
  })
  async list(
    @OrganizationId() organizationId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.portalTasksService.listForManagement(
      organizationId,
      includeArchived === 'true',
    );
  }

  @Post()
  @RequirePermission('task', 'create')
  @ApiOperation({
    summary: 'Create a portal task',
    description:
      'Creates a custom employee portal task. Publishing it assigns it to everyone with the compliance obligation — there is no per-person targeting.',
  })
  @ApiBody({ type: CreatePortalTaskDto })
  @ApiResponse({ status: 201, description: 'The created portal task' })
  async create(
    @OrganizationId() organizationId: string,
    @MemberId() memberId: string | undefined,
    @Body() body: CreatePortalTaskDto,
  ) {
    return this.portalTasksService.create(organizationId, memberId, body);
  }

  @Patch(':id')
  @RequirePermission('task', 'update')
  @ApiOperation({
    summary: 'Update a portal task',
    description:
      'Updates a portal task. Use isPublished to assign it to the portal audience or pull it back to draft, and isArchived to remove it from the portal.',
  })
  @ApiBody({ type: UpdatePortalTaskDto })
  @ApiResponse({ status: 200, description: 'The updated portal task' })
  async update(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() body: UpdatePortalTaskDto,
  ) {
    return this.portalTasksService.update(organizationId, id, body);
  }

  @Delete(':id')
  @RequirePermission('task', 'delete')
  @ApiOperation({
    summary: 'Archive a portal task',
    description:
      'Archives a portal task so it leaves the employee portal. Completion records are kept as compliance evidence rather than deleted.',
  })
  @ApiResponse({ status: 200, description: 'The archived portal task' })
  async archive(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.portalTasksService.archive(organizationId, id);
  }

  @Get(':id/completions')
  @RequirePermission('task', 'read')
  @ApiOperation({
    summary: 'List portal task completions',
    description:
      'Returns every member in the portal audience for one task with their completion timestamp, or null when outstanding. Use to chase down who still owes it.',
  })
  @ApiResponse({ status: 200, description: 'Per-member completion status' })
  async listCompletions(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.portalTasksService.listCompletions(organizationId, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('portal', 'update')
  @ApiOperation({
    summary: 'Complete a portal task',
    description:
      'Marks a portal task complete for the authenticated member and snapshots the acknowledgement wording. Re-confirming keeps the original timestamp.',
  })
  @ApiResponse({ status: 200, description: 'The completion record' })
  async complete(
    @OrganizationId() organizationId: string,
    @MemberId() memberId: string | undefined,
    @Param('id') id: string,
  ) {
    if (!memberId) {
      throw new BadRequestException('Session authentication required');
    }

    return this.portalTasksService.complete(organizationId, memberId, id);
  }
}
