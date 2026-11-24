import { describe, expect, it } from 'bun:test';
import type { InventoryDevice } from '../../../device-inventory-types';
import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, CheckFindingResult, CheckPassingResult } from '../../../types';
import { deviceListCheck } from '../checks';

const device = (overrides: Partial<InventoryDevice> & { id: string }): InventoryDevice => ({
  name: `Laptop ${overrides.id}`,
  hostname: `laptop-${overrides.id}`,
  platform: 'macos',
  osVersion: '15.1',
  serialNumber: `SN-${overrides.id}`,
  hardwareModel: 'MacBookPro18,1',
  owner: { memberId: 'mem_1', email: 'ada@acme.com', name: 'Ada Lovelace' },
  lastCheckIn: '2026-11-20T09:00:00.000Z',
  installedAt: '2026-01-05T09:00:00.000Z',
  ...overrides,
});

const run = async (data: InventoryDevice[] | null) => {
  const passes: CheckPassingResult[] = [];
  const fails: CheckFindingResult[] = [];
  const ctx = {
    log: () => {},
    warn: () => {},
    error: () => {},
    pass: (result: CheckPassingResult) => passes.push(result),
    fail: (finding: CheckFindingResult) => fails.push(finding),
    devices: data ? { getAgentDevices: async () => data } : undefined,
  } as unknown as CheckContext;
  await deviceListCheck.run(ctx);
  return { passes, fails };
};

describe('deviceListCheck', () => {
  it('maps to the Device List task under the Devices service', () => {
    expect(deviceListCheck.taskMapping).toBe(TASK_TEMPLATES.deviceList);
    expect(deviceListCheck.service).toBe('devices');
  });

  it('passes every tracked device with auditable evidence', async () => {
    const { passes, fails } = await run([
      device({ id: 'dev_1' }),
      device({
        id: 'dev_2',
        platform: 'windows',
        osVersion: '11',
        owner: { memberId: 'mem_2', email: 'bob@acme.com', name: null },
      }),
    ]);

    expect(fails).toHaveLength(0);
    expect(passes.map((p) => p.resourceId)).toEqual(['dev_1', 'dev_2']);
    expect(passes[0]?.resourceType).toBe('device');
    expect(passes[0]?.description).toContain('Ada Lovelace (ada@acme.com)');
    expect(passes[0]?.description).toContain('macOS 15.1');
    expect(passes[1]?.description).toContain('assigned to bob@acme.com');
    expect(passes[0]?.evidence).toMatchObject({
      source: 'dilligent-device-agent',
      deviceId: 'dev_1',
      serialNumber: 'SN-dev_1',
      ownerMemberId: 'mem_1',
      lastCheckIn: '2026-11-20T09:00:00.000Z',
    });
  });

  it('still passes a device that has never checked in', async () => {
    const { passes, fails } = await run([device({ id: 'dev_1', lastCheckIn: null })]);

    expect(fails).toHaveLength(0);
    expect(passes[0]?.evidence).toMatchObject({ lastCheckIn: null });
  });

  it('fails once at the organization level when no device runs the agent', async () => {
    const { passes, fails } = await run([]);

    expect(passes).toHaveLength(0);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatchObject({
      resourceType: 'organization',
      resourceId: 'device-inventory',
      severity: 'medium',
    });
    expect(fails[0]?.remediation).toContain('Dilligent device agent');
  });

  it('errors instead of failing when the host supplies no inventory', async () => {
    await expect(run(null)).rejects.toThrow('device inventory is not available');
  });
});
