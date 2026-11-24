/**
 * Device inventory for integration checks.
 *
 * The `@trycompai/integration-platform` package has no database of its own, so
 * checks that evidence the device inventory receive a host-supplied
 * {@link DeviceInventoryProvider}. This module is that host implementation,
 * backed by Prisma.
 *
 * Used by the Dilligent Device List check.
 */

import type {
  DeviceInventoryProvider,
  InventoryDevice,
} from '@trycompai/integration-platform';
import { db } from '@db';

/**
 * Build a {@link DeviceInventoryProvider} scoped to one organization.
 *
 * Returns every device running the Dilligent device agent, the same agent
 * devices People > Devices lists. Devices imported by other integrations
 * (`source: integration`) are left out because those integrations evidence
 * their own inventories. The query is deferred until a check asks for it.
 */
export function createDeviceInventoryProvider({
  organizationId,
}: {
  organizationId: string;
}): DeviceInventoryProvider {
  return {
    getAgentDevices: async () => {
      const devices = await db.device.findMany({
        where: { organizationId, source: 'agent' },
        select: {
          id: true,
          name: true,
          hostname: true,
          platform: true,
          osVersion: true,
          serialNumber: true,
          hardwareModel: true,
          memberId: true,
          lastCheckIn: true,
          installedAt: true,
          member: { select: { user: { select: { email: true, name: true } } } },
        },
        orderBy: { installedAt: 'asc' },
      });

      return devices.map((device): InventoryDevice => ({
        id: device.id,
        name: device.name,
        hostname: device.hostname,
        platform: device.platform,
        osVersion: device.osVersion,
        serialNumber: device.serialNumber,
        hardwareModel: device.hardwareModel,
        owner: {
          memberId: device.memberId,
          email: device.member.user.email.trim().toLowerCase(),
          name: device.member.user.name?.trim() || null,
        },
        lastCheckIn: device.lastCheckIn?.toISOString() ?? null,
        installedAt: device.installedAt.toISOString(),
      }));
    },
  };
}
