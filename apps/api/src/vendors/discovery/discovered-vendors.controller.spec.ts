// The DTOs' @IsEnum decorators read these at module-evaluation time, so the mock has to
// carry them — an empty db mock makes the DTO module throw before any test runs.
jest.mock('@db', () => ({
  db: {},
  DiscoveredVendorStatus: { pending: 'pending', approved: 'approved', ignored: 'ignored' },
  VendorCategory: {
    cloud_infrastructure: 'cloud_infrastructure',
    engineering_developer_tools: 'engineering_developer_tools',
    security_compliance: 'security_compliance',
    identity_access_management: 'identity_access_management',
    artificial_intelligence: 'artificial_intelligence',
    data_provider: 'data_provider',
    data_enrichment: 'data_enrichment',
    data_collection: 'data_collection',
    automation_integration: 'automation_integration',
    analytics_observability: 'analytics_observability',
    collaboration_productivity: 'collaboration_productivity',
    design_creative: 'design_creative',
    finance: 'finance',
    marketing: 'marketing',
    sales: 'sales',
    hr_recruiting: 'hr_recruiting',
    legal: 'legal',
    customer_support: 'customer_support',
    other: 'other',
  },
  VendorSource: { manual: 'manual', discovered: 'discovered' },
  DiscoveredVendorSource: { google_workspace: 'google_workspace' },
}));
jest.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: jest.fn() } }));
jest.mock('@trycompai/auth', () => ({
  statement: {},
  ac: { newRole: () => ({}) },
}));
jest.mock('../../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../auth/permission.guard';
import { RequirePermission } from '../../auth/require-permission.decorator';
import { DiscoveredVendorsController } from './discovered-vendors.controller';
import { VendorAccessController } from './vendor-access.controller';

/**
 * These assert the permission *contract* of each endpoint rather than the guard's behaviour,
 * which the guard's own tests cover. The failure this catches is an endpoint added without a
 * @RequirePermission — which silently skips both authorization and audit logging, since the
 * AuditLogInterceptor only records when that metadata is present.
 */
const permissionsFor = (controller: object, method: string) =>
  new Reflector().get<Array<{ resource: string; actions: string[] }>>(
    PERMISSIONS_KEY,
    (controller as Record<string, () => unknown>)[method],
  );

describe('DiscoveredVendorsController permissions', () => {
  const proto = DiscoveredVendorsController.prototype;

  it.each([
    ['list', 'read'],
    ['pendingCount', 'read'],
    ['findOne', 'read'],
    ['approve', 'create'],
    ['ignore', 'update'],
    ['reopen', 'update'],
    ['rescan', 'update'],
  ])('%s requires vendor:%s', (method, action) => {
    expect(permissionsFor(proto, method)).toEqual([
      { resource: 'vendor', actions: [action] },
    ]);
  });

  it('gates approval behind create rather than read', () => {
    // Approving mints a vendor in the register; read access must not be enough.
    expect(permissionsFor(proto, 'approve')).toEqual([
      { resource: 'vendor', actions: ['create'] },
    ]);
  });

  it('declares a permission on every route handler', () => {
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && name !== 'envelope',
    );

    expect(handlers.length).toBeGreaterThan(0);
    for (const handler of handlers) {
      expect(permissionsFor(proto, handler)).toBeDefined();
    }
  });

  it('uses the vendor resource throughout rather than inventing a new one', () => {
    // A candidate is a prospective vendor, so it is governed by vendor permissions —
    // a separate resource would leave existing roles silently unable to review the queue.
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && name !== 'envelope',
    );

    for (const handler of handlers) {
      expect(permissionsFor(proto, handler)?.[0].resource).toBe('vendor');
    }
  });
});

describe('VendorAccessController permissions', () => {
  const proto = VendorAccessController.prototype;

  it.each([['listVendorAccess'], ['listMemberAccess']])(
    '%s requires vendor:read',
    (method) => {
      expect(permissionsFor(proto, method)).toEqual([
        { resource: 'vendor', actions: ['read'] },
      ]);
    },
  );
});

describe('RequirePermission metadata shape', () => {
  it('matches the shape these tests read', () => {
    // Guards against the assertions above silently passing if the decorator changes.
    class Probe {
      @RequirePermission('vendor', 'read')
      handler() {}
    }
    expect(permissionsFor(Probe.prototype, 'handler')).toEqual([
      { resource: 'vendor', actions: ['read'] },
    ]);
  });
});
