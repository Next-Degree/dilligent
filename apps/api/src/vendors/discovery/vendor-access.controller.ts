import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthContext, OrganizationId } from '../../auth/auth-context.decorator';
import type { AuthContext as AuthContextType } from '../../auth/types';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequirePermission } from '../../auth/require-permission.decorator';
import { VendorAccessService } from './vendor-access.service';

const envelope = (authContext: AuthContextType) => ({
  authType: authContext.authType,
  ...(authContext.userId &&
    authContext.userEmail && {
      authenticatedUser: { id: authContext.userId, email: authContext.userEmail },
    }),
});

@ApiTags('Vendors')
@Controller({ version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class VendorAccessController {
  constructor(private readonly vendorAccess: VendorAccessService) {}

  @Get('vendors/:id/access')
  @RequirePermission('vendor', 'read')
  @ApiOperation({ summary: 'List the members who have authorized access to a vendor' })
  async listVendorAccess(
    @Param('id') vendorId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const data = await this.vendorAccess.listForVendor({ organizationId, vendorId });
    return { data, count: data.length, ...envelope(authContext) };
  }

  @Get('people/:memberId/vendor-access')
  @RequirePermission('vendor', 'read')
  @ApiOperation({ summary: 'List the vendors and applications a member has authorized' })
  async listMemberAccess(
    @Param('memberId') memberId: string,
    @OrganizationId() organizationId: string,
    @AuthContext() authContext: AuthContextType,
  ) {
    const data = await this.vendorAccess.listForMember({ organizationId, memberId });
    return { data, count: data.length, ...envelope(authContext) };
  }
}
