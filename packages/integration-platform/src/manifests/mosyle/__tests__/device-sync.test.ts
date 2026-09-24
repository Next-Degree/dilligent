import { describe, expect, it, mock } from 'bun:test';
import { SyncDeviceSchema } from '../../../dsl/types';
import type { CheckContext } from '../../../types';
import { buildDeviceChecks, buildUserEmailIndex, mapDevice, runDeviceSync } from '../device-sync';
import type { MosyleDevice, MosyleEnvelope } from '../types';

/** Shaped after the documented /v1/devices response. */
const macDevice = (overrides: Partial<MosyleDevice> = {}): MosyleDevice => ({
  deviceudid: '00001234-000123400000A01B',
  serial_number: 'A12B345K3P',
  device_name: "Ada's MacBook Pro",
  device_model: 'MacBookPro18,3',
  device_model_name: 'MacBook Pro 16" (2021)',
  osversion: '14.4.1',
  os: 'mac',
  status: 'IN',
  is_deleted: '0',
  useremail: 'Ada@Example.com',
  date_last_beat: '1694210851',
  ...overrides,
});

const envelope = (payload: Record<string, unknown>): MosyleEnvelope => ({
  status: 'OK',
  response: [payload],
});

describe('buildDeviceChecks', () => {
  it('maps the documented Mosyle attributes to checks', () => {
    const checks = buildDeviceChecks(
      macDevice({
        is_supervised: '1',
        SystemIntegrityProtectionEnabled: '1',
        has_password: '0',
        isActivationLockEnabled: '1',
      }),
    );

    expect(checks).toEqual([
      { id: 'password_policy', label: 'Passcode Set', passed: false },
      { id: 'supervised', label: 'Supervised', passed: true },
      { id: 'sip', label: 'System Integrity Protection', passed: true },
      { id: 'activation_lock', label: 'Activation Lock', passed: true },
    ]);
  });

  it("emits the passcode signal under Comp AI's canonical id so it counts toward compliance", () => {
    // The devices pane only credits canonical slugs (disk_encryption,
    // antivirus, password_policy, screen_lock) toward its verdict; a
    // Mosyle-specific id here would render the device "Not tracked".
    expect(buildDeviceChecks(macDevice({ has_password: '1' }))).toEqual([
      { id: 'password_policy', label: 'Passcode Set', passed: true },
    ]);
  });

  it('omits signals the provider did not report', () => {
    expect(buildDeviceChecks(macDevice())).toEqual([]);
  });

  it('reads needosupdate by presence — a pending version means out of date', () => {
    expect(buildDeviceChecks(macDevice({ needosupdate: '14.5' }))).toEqual([
      { id: 'os_up_to_date', label: 'OS Up To Date', passed: false },
    ]);
    expect(buildDeviceChecks(macDevice({ needosupdate: null }))).toEqual([
      { id: 'os_up_to_date', label: 'OS Up To Date', passed: true },
    ]);
  });
});

describe('buildUserEmailIndex', () => {
  it('indexes active users by their Mosyle id', () => {
    const index = buildUserEmailIndex([
      { iduser: '100001', email: 'End.User01@mosyle.com', is_removed: false },
      { iduser: '100002', email: 'end.user02@mosyle.com', is_removed: true },
      { iduser: '100003' },
    ]);

    expect(index.get('100001')).toBe('end.user01@mosyle.com');
    expect(index.has('100002')).toBe(false);
    expect(index.has('100003')).toBe(false);
  });
});

describe('mapDevice', () => {
  it('produces a device that satisfies SyncDeviceSchema', () => {
    const mapped = mapDevice(macDevice({ is_supervised: '1' }));
    expect(SyncDeviceSchema.safeParse(mapped).success).toBe(true);
  });

  it('normalizes the identifying fields', () => {
    expect(mapDevice(macDevice())).toMatchObject({
      name: "Ada's MacBook Pro",
      platform: 'macos',
      // Lower-cased because member matching is done on a normalized email.
      userEmail: 'ada@example.com',
      status: 'active',
      serialNumber: 'A12B345K3P',
      externalId: '00001234-000123400000A01B',
      osVersion: '14.4.1',
      // Prefers the human-readable model name over the identifier.
      hardwareModel: 'MacBook Pro 16" (2021)',
      lastSeenAt: '2023-09-08T22:07:31.000Z',
    });
  });

  it('derives isCompliant only from the signals actually reported', () => {
    expect(
      mapDevice(macDevice({ is_supervised: '1', SystemIntegrityProtectionEnabled: '1' }))
        ?.isCompliant,
    ).toBe(true);
    expect(mapDevice(macDevice({ is_supervised: '1', has_password: '0' }))?.isCompliant).toBe(
      false,
    );
  });

  it('omits compliance entirely when Mosyle reports no signals', () => {
    const mapped = mapDevice(macDevice());
    expect(mapped).not.toHaveProperty('isCompliant');
    expect(mapped).not.toHaveProperty('checks');
  });

  it('resolves the email from the user index when the device carries only a userid', () => {
    const device = macDevice({ useremail: undefined, username: undefined, userid: '100001' });
    const index = new Map([['100001', 'ada@example.com']]);

    expect(mapDevice(device, index)?.userEmail).toBe('ada@example.com');
    expect(mapDevice(device)).toBeNull();
  });

  it('returns null when there is no usable user email to match a member', () => {
    expect(mapDevice(macDevice({ useremail: undefined, username: undefined }))).toBeNull();
    expect(mapDevice(macDevice({ useremail: 'not-an-email' }))).toBeNull();
  });

  it('returns null when the device has neither a serial number nor a UDID', () => {
    expect(mapDevice(macDevice({ serial_number: undefined, deviceudid: undefined }))).toBeNull();
  });

  it('marks deleted devices inactive so they are removed on the next sync', () => {
    expect(mapDevice(macDevice({ is_deleted: '1' }))?.status).toBe('inactive');
  });
});

// ============================================================================
// runDeviceSync
// ============================================================================

const credentials = {
  environment: 'business',
  access_token: 'token-123',
  admin_email: 'admin@example.com',
  admin_password: 'secret',
};

function createContext(post: ReturnType<typeof mock>, postRaw?: ReturnType<typeof mock>) {
  const warnings: string[] = [];
  const raw =
    postRaw ??
    mock(async () => ({ status: 200, headers: { authorization: 'Bearer jwt-abc' }, body: {} }));

  const ctx = {
    credentials,
    accessToken: '',
    variables: {},
    connectionId: 'conn-1',
    organizationId: 'org-1',
    log: () => {},
    warn: (message: string) => warnings.push(message),
    error: () => {},
    post,
    postRaw: raw,
  } as unknown as CheckContext;

  return { ctx, warnings, postRaw: raw };
}

describe('runDeviceSync', () => {
  it('logs in via postRaw, then requests only Macs and maps them', async () => {
    const post = mock(async () => envelope({ devices: [macDevice()], rows: 1 }));
    const { ctx, postRaw } = createContext(post);

    const devices = await runDeviceSync(ctx);

    expect(devices).toHaveLength(1);
    expect(devices[0]?.serialNumber).toBe('A12B345K3P');

    const [loginPath, loginBody, loginOpts] = postRaw.mock.calls[0];
    expect(loginPath).toBe('/v1/login');
    expect(loginBody).toEqual({ email: 'admin@example.com', password: 'secret' });
    expect(loginOpts.baseUrl).toBe('https://businessapi.mosyle.com');
    expect(loginOpts.headers.accessToken).toBe('token-123');

    const [listPath, listBody, listOpts] = post.mock.calls[0];
    expect(listPath).toBe('/v1/devices');
    // iOS, tvOS and visionOS are deliberately not requested — DevicePlatform
    // cannot store them.
    expect(listBody).toEqual({
      operation: 'list',
      options: { os: 'mac', page: 1, page_size: 500 },
    });
    expect(listOpts.headers).toMatchObject({
      accessToken: 'token-123',
      Authorization: 'Bearer jwt-abc',
    });
  });

  it('reads the JWT from the Authorization response header', async () => {
    const post = mock(async () => envelope({ devices: [], rows: 0 }));
    const postRaw = mock(async () => ({
      status: 200,
      headers: { authorization: 'Bearer header-jwt' },
      // The documented body carries no token at all.
      body: { UserID: '1', email: 'admin@example.com' },
    }));

    const { ctx } = createContext(post, postRaw);
    await runDeviceSync(ctx);

    expect(post.mock.calls[0][2].headers.Authorization).toBe('Bearer header-jwt');
  });

  it('treats a DEVICES_NOTFOUND response as an empty fleet', async () => {
    const post = mock(async () =>
      envelope({ status: 'DEVICES_NOTFOUND', info: 'No devices found' }),
    );
    const { ctx } = createContext(post);

    expect(await runDeviceSync(ctx)).toEqual([]);
  });

  it('surfaces a malformed request rather than reporting zero devices', async () => {
    const post = mock(async () => envelope({ status: 'MISSING_DATA', info: 'Missing key: os' }));
    const { ctx } = createContext(post);

    await expect(runDeviceSync(ctx)).rejects.toThrow('MISSING_DATA');
  });

  it('looks up users only when a device is missing its email', async () => {
    const post = mock(async (path: string) => {
      if (path === '/v1/users') {
        return envelope({ users: [{ iduser: '100001', email: 'ada@example.com' }], rows: 1 });
      }
      return envelope({
        devices: [macDevice({ useremail: undefined, username: undefined, userid: '100001' })],
        rows: 1,
      });
    });

    const { ctx } = createContext(post);
    const devices = await runDeviceSync(ctx);

    expect(devices).toHaveLength(1);
    expect(devices[0]?.userEmail).toBe('ada@example.com');
    expect(post.mock.calls.some(([path]) => path === '/v1/users')).toBe(true);
  });

  it('does not call /v1/users when every device already carries an email', async () => {
    const post = mock(async () => envelope({ devices: [macDevice()], rows: 1 }));
    const { ctx } = createContext(post);

    await runDeviceSync(ctx);

    expect(post.mock.calls.some(([path]) => path === '/v1/users')).toBe(false);
  });

  it('degrades to email-bearing devices when the user lookup fails', async () => {
    const post = mock(async (path: string) => {
      if (path === '/v1/users') throw new Error('403 Forbidden');
      return envelope({
        devices: [macDevice(), macDevice({ useremail: undefined, userid: '100001' })],
        rows: 2,
      });
    });

    const { ctx, warnings } = createContext(post);
    const devices = await runDeviceSync(ctx);

    expect(devices).toHaveLength(1);
    expect(warnings.some((w) => w.includes('Could not list Mosyle users'))).toBe(true);
    expect(warnings.some((w) => w.includes('Skipped 1 Mosyle device'))).toBe(true);
  });

  it('walks every page until a short page ends the fleet', async () => {
    const fullPage = Array.from({ length: 500 }, (_, index) =>
      macDevice({ deviceudid: `udid-${index}`, serial_number: `SERIAL-${index}` }),
    );
    const post = mock(async (_path: string, body?: unknown) => {
      const page = (body as { options: { page: number } }).options.page;
      return page === 1
        ? envelope({ devices: fullPage, rows: 501 })
        : envelope({
            devices: [macDevice({ deviceudid: 'last', serial_number: 'LAST' })],
            rows: 501,
          });
    });

    const { ctx } = createContext(post);

    expect(await runDeviceSync(ctx)).toHaveLength(501);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('stops paginating once the reported row total is reached', async () => {
    const fullPage = Array.from({ length: 500 }, (_, index) =>
      macDevice({ deviceudid: `udid-${index}`, serial_number: `SERIAL-${index}` }),
    );
    const post = mock(async () => envelope({ devices: fullPage, rows: 500 }));
    const { ctx } = createContext(post);

    expect(await runDeviceSync(ctx)).toHaveLength(500);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when Mosyle returns no session token', async () => {
    const post = mock(async () => envelope({ devices: [] }));
    const postRaw = mock(async () => ({ status: 200, headers: {}, body: { UserID: '1' } }));
    const { ctx } = createContext(post, postRaw);

    await expect(runDeviceSync(ctx)).rejects.toThrow('returned no Authorization token');
  });

  it('fails clearly when the admin login credentials are missing', async () => {
    const post = mock(async () => envelope({ devices: [] }));
    const { ctx } = createContext(post);
    (ctx.credentials as Record<string, string>).admin_password = '';

    await expect(runDeviceSync(ctx)).rejects.toThrow('admin email and password are required');
  });
});
