import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../auth/auth-context.decorator';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import type { AuthContext as AuthContextType } from '../auth/types';
import {
  INBOX_DEFAULT_LIMIT,
  ListInboxQueryDto,
} from './dto/list-inbox-query.dto';
import { InboxService } from './inbox.service';

@ApiTags('Inbox')
@Controller({ path: 'inbox', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  @Get()
  // Product gate only. Each source additionally checks the resource it reads.
  @RequirePermission('app', 'read')
  @ApiOperation({
    summary: 'List inbox items',
    // 120–158 chars: long enough to be used as-is for the docs page, short
    // enough that the SEO copy (trimmed at 158) keeps the whole sentence.
    description:
      'List what needs attention in an organization, most urgent first: failing tasks, regressed cloud findings, and broken integrations the caller can read.',
  })
  async list(
    @AuthContext() authContext: AuthContextType,
    @Query() query: ListInboxQueryDto,
  ) {
    const { items, totals } = await this.inboxService.list({
      auth: authContext,
      limit: query.limit ?? INBOX_DEFAULT_LIMIT,
    });
    return { data: items, count: items.length, totals };
  }
}
