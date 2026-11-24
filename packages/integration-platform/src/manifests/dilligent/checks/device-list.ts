import type { InventoryDevice } from '../../../device-inventory-types';
import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';

const PLATFORM_LABELS: Record<InventoryDevice['platform'], string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
};

const ownerLabel = ({ owner }: InventoryDevice): string =>
  owner.name ? `${owner.name} (${owner.email})` : owner.email;

/**
 * Device List
 *
 * Evidences the device inventory kept by the Dilligent device agent: one
 * passing result per tracked device. Only an empty inventory fails, so this
 * check never turns the task red over a single unenrolled laptop; it answers
 * whether devices are tracked at all, the same question the Mosyle check asks
 * of Mosyle.
 *
 * Maps to: Device List
 */
export const deviceListCheck: IntegrationCheck = {
  id: 'dilligent-device-list',
  name: 'Device List',
  description:
    'Verify devices are tracked in the Dilligent device inventory by the Dilligent device agent',
  service: 'devices',
  taskMapping: TASK_TEMPLATES.deviceList,
  defaultSeverity: 'medium',

  run: async (ctx: CheckContext) => {
    if (!ctx.devices) {
      // Only hosts without database access omit it. Throwing marks the run as
      // errored rather than failing the task over a gap on our side.
      throw new Error('The device inventory is not available to this check run');
    }

    const now = new Date().toISOString();
    const devices = await ctx.devices.getAgentDevices();

    if (devices.length === 0) {
      ctx.fail({
        title: 'No devices tracked by the Dilligent device agent',
        description:
          'No device in this organization runs the Dilligent device agent, so the device inventory is empty.',
        resourceType: 'organization',
        resourceId: 'device-inventory',
        severity: 'medium',
        remediation:
          'Ask each employee to sign in to the employee portal and install the Dilligent device agent on their work devices. The check passes on its next run.',
        evidence: { source: 'dilligent-device-agent', deviceCount: 0, checkedAt: now },
      });
      return;
    }

    for (const device of devices) {
      const platform = PLATFORM_LABELS[device.platform];
      const owner = ownerLabel(device);
      ctx.pass({
        title: `Device tracked: ${device.name}`,
        description: `${device.name} (${platform} ${device.osVersion}) is assigned to ${owner} and tracked by the Dilligent device agent.`,
        resourceType: 'device',
        resourceId: device.id,
        evidence: {
          source: 'dilligent-device-agent',
          deviceId: device.id,
          name: device.name,
          hostname: device.hostname,
          platform: device.platform,
          osVersion: device.osVersion,
          serialNumber: device.serialNumber,
          hardwareModel: device.hardwareModel,
          ownerMemberId: device.owner.memberId,
          ownerEmail: device.owner.email,
          ownerName: device.owner.name,
          installedAt: device.installedAt,
          lastCheckIn: device.lastCheckIn,
          checkedAt: now,
        },
      });
    }

    ctx.log(`Device inventory: ${devices.length} device(s) tracked by the Dilligent device agent`);
  },
};
