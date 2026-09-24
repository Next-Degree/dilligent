import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import { listDevices, login } from '../client';
import { MOSYLE_DEVICE_OS_VALUES } from '../types';

/**
 * Evidences that a managed device inventory exists in Mosyle.
 *
 * Covers every OS family Mosyle manages, not just Macs — the inventory task
 * asks whether devices are tracked at all, which iPhones and iPads satisfy even
 * though the device sync cannot store them.
 */
export const deviceListCheck: IntegrationCheck = {
  id: 'device_list',
  name: 'Device List',
  description:
    'Retrieve a comprehensive list of all managed devices from Mosyle, including iPads, iPhones, Macs, and Apple TVs with their security status and configuration details.',
  service: 'device-inventory',
  taskMapping: TASK_TEMPLATES.deviceList,
  defaultSeverity: 'medium',

  run: async (ctx) => {
    const jwt = await login(ctx);

    for (const os of MOSYLE_DEVICE_OS_VALUES) {
      const devices = await listDevices(ctx, { os, jwt });
      ctx.log(`Mosyle reports ${devices.length} ${os} device(s)`);

      if (devices.length === 0) {
        ctx.fail({
          title: `No ${os} devices enrolled in Mosyle`,
          description: `Mosyle returned no ${os} devices, so this device class is not covered by the managed inventory.`,
          resourceType: 'mosyle_device_class',
          resourceId: os,
          severity: 'medium',
          remediation:
            '1. Open the Mosyle admin console\n2. Go to Devices\n3. Enroll the devices for this platform, or confirm none are in use',
        });
        continue;
      }

      ctx.pass({
        title: `${devices.length} ${os} device(s) managed in Mosyle`,
        description: 'Mosyle maintains an inventory of these enrolled devices.',
        resourceType: 'mosyle_device_class',
        resourceId: os,
        evidence: {
          deviceCount: devices.length,
          // Identifiers only — the full records carry user PII that does not
          // belong in stored evidence.
          sample: devices.slice(0, 25).map((device) => ({
            udid: device.deviceudid,
            serialNumber: device.serial_number,
            model: device.device_model_name ?? device.device_model,
            osVersion: device.osversion,
          })),
        },
      });
    }
  },
};
