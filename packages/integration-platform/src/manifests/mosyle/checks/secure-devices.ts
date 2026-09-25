import type { IntegrationCheck } from '../../../types';
import { listDevices, login } from '../client';
import { buildDeviceChecks } from '../device-sync';

/**
 * Flags managed Macs whose Mosyle-reported security signals are failing.
 *
 * Macs only: System Integrity Protection has no iOS/tvOS equivalent, so folding
 * those platforms in would fail every one of them for a signal Mosyle never
 * reports.
 */
export const secureDevicesCheck: IntegrationCheck = {
  id: 'secure_devices',
  name: 'Secure Devices',
  description:
    'Identify devices that meet security requirements including supervision status, encryption, and compliance with organizational security policies.',
  service: 'device-compliance',
  defaultSeverity: 'high',

  run: async (ctx) => {
    const jwt = await login(ctx);
    const devices = await listDevices(ctx, { os: 'mac', jwt });

    ctx.log(`Evaluating security posture for ${devices.length} Mac device(s)`);

    for (const device of devices) {
      const resourceId = device.serial_number ?? device.deviceudid;
      if (!resourceId) {
        ctx.warn('Skipping a Mosyle device with no serial number or UDID');
        continue;
      }

      const name = device.device_name ?? resourceId;
      const checks = buildDeviceChecks(device);

      // No reported signals is not a pass. Mosyle returns nothing here when the
      // device has not checked in or the tenant does not collect these fields,
      // and calling that "secure" would manufacture evidence.
      if (checks.length === 0) {
        ctx.fail({
          title: `${name} reports no security status`,
          description:
            'Mosyle returned no supervision, System Integrity Protection, or passcode signals for this device, so its posture cannot be verified.',
          resourceType: 'device',
          resourceId,
          severity: 'medium',
          remediation:
            '1. Open the device in the Mosyle admin console\n2. Confirm it has checked in recently\n3. Enable the profiles that report supervision and System Integrity Protection status',
        });
        continue;
      }

      const failed = checks.filter((check) => !check.passed);

      if (failed.length === 0) {
        ctx.pass({
          title: `${name} meets Mosyle security requirements`,
          description: `All ${checks.length} security signal(s) reported by Mosyle are passing.`,
          resourceType: 'device',
          resourceId,
          evidence: { checks, model: device.device_model_name ?? device.device_model },
        });
        continue;
      }

      ctx.fail({
        title: `${name} fails ${failed.length} Mosyle security check(s)`,
        description: `Failing: ${failed.map((check) => check.label).join(', ')}.`,
        resourceType: 'device',
        resourceId,
        severity: 'high',
        remediation:
          '1. Open the device in the Mosyle admin console\n2. Review the failing signals listed above\n3. Push the profiles that enforce them (supervision, passcode policy, OS updates)',
      });
    }
  },
};
