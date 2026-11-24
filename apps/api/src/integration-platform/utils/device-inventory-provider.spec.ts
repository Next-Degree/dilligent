import { createDeviceInventoryProvider } from './device-inventory-provider';

const findDevices = jest.fn();

jest.mock('@db', () => ({
  db: {
    device: { findMany: (...args: unknown[]) => findDevices(...args) },
  },
}));

interface DeviceRow {
  id: string;
  name: string;
  hostname: string;
  platform: 'macos' | 'windows' | 'linux';
  osVersion: string;
  serialNumber: string | null;
  hardwareModel: string | null;
  memberId: string;
  lastCheckIn: Date | null;
  installedAt: Date;
  member: { user: { email: string; name: string | null } };
}

const makeDevice = (overrides: Partial<DeviceRow> = {}): DeviceRow => ({
  id: 'dev_1',
  name: "Ada's MacBook",
  hostname: 'ada-mbp',
  platform: 'macos',
  osVersion: '15.1',
  serialNumber: 'C02XYZ',
  hardwareModel: 'MacBookPro18,1',
  memberId: 'mem_1',
  lastCheckIn: new Date('2026-11-20T09:00:00.000Z'),
  installedAt: new Date('2026-01-05T09:00:00.000Z'),
  member: { user: { email: ' Ada@Acme.com ', name: ' Ada Lovelace ' } },
  ...overrides,
});

const load = () =>
  createDeviceInventoryProvider({ organizationId: 'org_1' }).getAgentDevices();

describe('createDeviceInventoryProvider', () => {
  beforeEach(() => {
    findDevices.mockReset();
  });

  it('does not query until a check asks for devices', () => {
    createDeviceInventoryProvider({ organizationId: 'org_1' });

    expect(findDevices).not.toHaveBeenCalled();
  });

  it('reads only agent devices, scoped to the organization', async () => {
    findDevices.mockResolvedValue([]);

    await load();

    expect(findDevices).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org_1', source: 'agent' },
      }),
    );
  });

  it('maps devices with normalized owner details and ISO timestamps', async () => {
    findDevices.mockResolvedValue([makeDevice()]);

    const devices = await load();

    expect(devices).toEqual([
      {
        id: 'dev_1',
        name: "Ada's MacBook",
        hostname: 'ada-mbp',
        platform: 'macos',
        osVersion: '15.1',
        serialNumber: 'C02XYZ',
        hardwareModel: 'MacBookPro18,1',
        owner: {
          memberId: 'mem_1',
          email: 'ada@acme.com',
          name: 'Ada Lovelace',
        },
        lastCheckIn: '2026-11-20T09:00:00.000Z',
        installedAt: '2026-01-05T09:00:00.000Z',
      },
    ]);
  });

  it('keeps a device that never checked in and an owner without a name', async () => {
    findDevices.mockResolvedValue([
      makeDevice({
        lastCheckIn: null,
        serialNumber: null,
        member: { user: { email: 'bob@acme.com', name: '   ' } },
      }),
    ]);

    const [device] = await load();

    expect(device?.lastCheckIn).toBeNull();
    expect(device?.serialNumber).toBeNull();
    expect(device?.owner.name).toBeNull();
  });
});
