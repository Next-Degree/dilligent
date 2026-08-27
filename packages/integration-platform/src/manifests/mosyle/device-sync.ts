import type { SyncDevice, SyncDeviceCheck } from '../../dsl/types';
import type { CheckContext } from '../../types';
import { listDevices, listUsers, login } from './client';
import { coerceBoolean, coerceTimestamp, isDeviceActive } from './parse';
import type { MosyleDevice, MosyleUser } from './types';

/**
 * Mosyle security signals mapped to the provider-vocabulary checks the device
 * list renders.
 *
 * Deliberately only the fields Mosyle actually documents for Macs — it reports
 * no FileVault, firewall or Gatekeeper attribute, so those are not tracked here
 * rather than being invented from a field that never arrives.
 */
const DEVICE_CHECKS: ReadonlyArray<{
  id: string;
  label: string;
  field: keyof MosyleDevice;
}> = [
  { id: 'supervised', label: 'Supervised', field: 'is_supervised' },
  { id: 'sip', label: 'System Integrity Protection', field: 'SystemIntegrityProtectionEnabled' },
  { id: 'passcode', label: 'Passcode Set', field: 'has_password' },
  { id: 'activation_lock', label: 'Activation Lock', field: 'isActivationLockEnabled' },
];

/** First non-empty string among the given fields, or undefined. */
function firstString(device: MosyleDevice, fields: ReadonlyArray<keyof MosyleDevice>) {
  for (const field of fields) {
    const value = device[field];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

/**
 * Builds the provider-reported check list. Only signals Mosyle actually
 * returned are included — an absent field means "not tracked", which the UI
 * shows differently from a failing check.
 */
export function buildDeviceChecks(device: MosyleDevice): SyncDeviceCheck[] {
  const checks: SyncDeviceCheck[] = [];

  for (const { id, label, field } of DEVICE_CHECKS) {
    const passed = coerceBoolean(device[field]);
    if (passed === undefined) continue;
    checks.push({ id, label, passed });
  }

  // `needosupdate` names a pending OS version, or is null when up to date —
  // so its presence, not its truthiness, is the failing condition.
  if (device.needosupdate !== undefined) {
    checks.push({
      id: 'os_up_to_date',
      label: 'OS Up To Date',
      passed: !device.needosupdate,
    });
  }

  return checks;
}

/** Maps Mosyle user ids to emails so devices carrying only a `userid` match. */
export function buildUserEmailIndex(users: MosyleUser[]): Map<string, string> {
  const index = new Map<string, string>();

  for (const user of users) {
    if (user.is_removed) continue;
    const email = typeof user.email === 'string' ? user.email.trim() : '';
    const id = typeof user.iduser === 'string' ? user.iduser.trim() : '';
    if (id && email.includes('@')) index.set(id, email.toLowerCase());
  }

  return index;
}

/**
 * Converts one Mosyle device into the platform's standardized shape.
 *
 * Returns null when the device cannot be represented: no assigned user (the
 * sync matches devices to members by email) or no stable identifier (an
 * unmatchable row would orphan on the next sync).
 */
export function mapDevice(
  device: MosyleDevice,
  userEmailById?: Map<string, string>,
): SyncDevice | null {
  const directEmail = firstString(device, ['useremail', 'username']);
  const userId = firstString(device, ['userid']);
  const resolvedEmail =
    directEmail && directEmail.includes('@')
      ? directEmail
      : userId
        ? userEmailById?.get(userId)
        : undefined;

  if (!resolvedEmail || !resolvedEmail.includes('@')) return null;

  const serialNumber = firstString(device, ['serial_number']);
  const externalId = firstString(device, ['deviceudid']);
  if (!serialNumber && !externalId) return null;

  const name =
    firstString(device, ['device_name']) ?? serialNumber ?? externalId ?? 'Mosyle device';
  const osVersion = firstString(device, ['osversion']);
  const hardwareModel = firstString(device, ['device_model_name', 'device_model', 'model_name']);
  const checks = buildDeviceChecks(device);
  const lastSeenAt = coerceTimestamp(
    device.date_last_beat ?? device.date_checkin ?? device.date_info,
  );

  return {
    name,
    platform: 'macos',
    userEmail: resolvedEmail.toLowerCase(),
    status: isDeviceActive(device) ? 'active' : 'inactive',
    ...(serialNumber ? { serialNumber } : {}),
    ...(externalId ? { externalId } : {}),
    ...(osVersion ? { osVersion } : {}),
    ...(hardwareModel ? { hardwareModel } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    // Mosyle has no single "compliant" flag, so compliance is derived: compliant
    // when every signal it *does* report passes. With no signals reported the
    // field is omitted, which renders as "Not tracked" rather than asserting a
    // state the source never claimed.
    ...(checks.length > 0 ? { isCompliant: checks.every((check) => check.passed) } : {}),
    ...(checks.length > 0 ? { checks } : {}),
  };
}

/**
 * Pulls every managed Mac from Mosyle and returns them in the standardized
 * device shape.
 *
 * Macs only, deliberately: `DevicePlatform` is macos/windows/linux, so the
 * iPhones, iPads, Apple TVs and Vision Pros Mosyle also manages have nowhere to
 * be stored. Requesting only `os: 'mac'` keeps that explicit instead of
 * silently dropping them after the fact.
 */
export async function runDeviceSync(ctx: CheckContext): Promise<SyncDevice[]> {
  const jwt = await login(ctx);

  const rawDevices = await listDevices(ctx, { os: 'mac', jwt });
  ctx.log(`Mosyle returned ${rawDevices.length} Mac device(s)`);

  // Only worth a round trip if some device is missing its email but names a user.
  const needsUserLookup = rawDevices.some(
    (device) => !firstString(device, ['useremail', 'username'])?.includes('@') && device.userid,
  );

  let userEmailById: Map<string, string> | undefined;
  if (needsUserLookup) {
    try {
      userEmailById = buildUserEmailIndex(await listUsers(ctx, jwt));
      ctx.log(`Resolved ${userEmailById.size} Mosyle user email(s) for device matching`);
    } catch (error) {
      // Degrade to devices that carry their own email rather than failing the run.
      ctx.warn(
        `Could not list Mosyle users, devices without an email will be skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const devices: SyncDevice[] = [];
  let skipped = 0;

  for (const raw of rawDevices) {
    const mapped = mapDevice(raw, userEmailById);
    if (!mapped) {
      skipped++;
      continue;
    }
    devices.push(mapped);
  }

  if (skipped > 0) {
    ctx.warn(
      `Skipped ${skipped} Mosyle device(s) with no resolvable user email or no serial/UDID — they cannot be matched to a member`,
    );
  }

  return devices;
}
