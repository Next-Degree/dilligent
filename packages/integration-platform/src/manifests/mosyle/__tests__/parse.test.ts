import { describe, expect, it } from 'bun:test';
import {
  coerceBoolean,
  coerceTimestamp,
  credential,
  extractDevices,
  extractLoginToken,
  extractUsers,
  isDeviceActive,
  payloadRows,
  resolveApiHost,
  resolveEnvironment,
  unwrapEnvelope,
} from '../parse';

describe('credential', () => {
  it('reads scalar values and the first entry of array values', () => {
    expect(credential({ access_token: 'abc' }, 'access_token')).toBe('abc');
    expect(credential({ regions: ['us-east-1', 'eu-west-1'] }, 'regions')).toBe('us-east-1');
  });

  it('returns an empty string for missing or empty credentials', () => {
    expect(credential({}, 'access_token')).toBe('');
    expect(credential({ regions: [] }, 'regions')).toBe('');
  });
});

describe('resolveEnvironment / resolveApiHost', () => {
  it('routes Manager tenants to the manager host', () => {
    expect(resolveEnvironment({ environment: 'manager' })).toBe('manager');
    expect(resolveApiHost({ environment: 'MANAGER' })).toBe('https://managerapi.mosyle.com');
  });

  it('defaults to Business for anything else, including a missing value', () => {
    expect(resolveEnvironment({})).toBe('business');
    expect(resolveEnvironment({ environment: 'nonsense' })).toBe('business');
    expect(resolveApiHost({ environment: 'business' })).toBe('https://businessapi.mosyle.com');
  });
});

describe('unwrapEnvelope', () => {
  it('returns the payload entries of a successful response', () => {
    expect(unwrapEnvelope({ status: 'OK', response: [{ devices: [], rows: 0 }] })).toEqual([
      { devices: [], rows: 0 },
    ]);
  });

  it('treats DEVICES_NOTFOUND and USERS_NOTFOUND as an empty result, not an error', () => {
    expect(
      unwrapEnvelope({ status: 'OK', response: [{ status: 'DEVICES_NOTFOUND', info: 'none' }] }),
    ).toEqual([]);
    expect(
      unwrapEnvelope({ status: 'OK', response: [{ status: 'USERS_NOTFOUND', info: 'none' }] }),
    ).toEqual([]);
  });

  it('throws on a malformed request rather than reporting an empty fleet', () => {
    expect(() =>
      unwrapEnvelope({
        status: 'OK',
        response: [{ status: 'MISSING_DATA', info: 'Missing key: os' }],
      }),
    ).toThrow('Mosyle API returned MISSING_DATA: Missing key: os');

    expect(() =>
      unwrapEnvelope({ status: 'OK', response: [{ status: 'UNKNOWN_COLUMNS' }] }),
    ).toThrow('UNKNOWN_COLUMNS');
  });

  it('returns an empty list for absent or unrecognized envelopes', () => {
    expect(unwrapEnvelope(null)).toEqual([]);
    expect(unwrapEnvelope({ status: 'OK' })).toEqual([]);
  });
});

describe('extractDevices / extractUsers', () => {
  it('flattens devices across every payload entry', () => {
    expect(
      extractDevices({
        status: 'OK',
        response: [{ devices: [{ deviceudid: 'a' }] }, { devices: [{ deviceudid: 'b' }] }],
      }),
    ).toEqual([{ deviceudid: 'a' }, { deviceudid: 'b' }]);
  });

  it('ignores return_only_ids user responses, which carry no emails', () => {
    expect(extractUsers({ status: 'OK', response: [{ users: [100001, 100002] }] })).toEqual([]);
    expect(
      extractUsers({ status: 'OK', response: [{ users: [{ iduser: '1', email: 'a@b.com' }] }] }),
    ).toEqual([{ iduser: '1', email: 'a@b.com' }]);
  });

  it('returns a count only when the payload reports one', () => {
    expect(payloadRows([{ rows: '42' }])).toBe(42);
    expect(payloadRows([{}])).toBeUndefined();
  });
});

describe('extractLoginToken', () => {
  it('reads the Authorization response header and strips the Bearer prefix', () => {
    expect(
      extractLoginToken({ authorization: 'Bearer jwt-abc' }, { UserID: '1', email: 'a@b.com' }),
    ).toBe('jwt-abc');
  });

  it('falls back to body fields for tenants that echo the token there', () => {
    expect(extractLoginToken(undefined, { Authorization: 'jwt-a' })).toBe('jwt-a');
    expect(extractLoginToken({}, { access_token: 'jwt-c' })).toBe('jwt-c');
    expect(extractLoginToken({}, { token: 'jwt-d' })).toBe('jwt-d');
  });

  it('returns null when no usable token is present', () => {
    // The documented body carries no token — only the header does.
    expect(extractLoginToken({}, { UserID: '1', email: 'a@b.com' })).toBeNull();
    expect(extractLoginToken(undefined, undefined)).toBeNull();
  });
});

describe('coerceBoolean', () => {
  it('reads the "1"/"0" strings Mosyle returns for boolean attributes', () => {
    expect(coerceBoolean('1')).toBe(true);
    expect(coerceBoolean('0')).toBe(false);
  });

  it('accepts the other spellings that appear across tenants', () => {
    for (const value of [true, 1, 'true', 'YES', 'on', 'enabled']) {
      expect(coerceBoolean(value)).toBe(true);
    }
    for (const value of [false, 0, 'false', 'NO', 'off', 'disabled']) {
      expect(coerceBoolean(value)).toBe(false);
    }
  });

  it('returns undefined for absent or unrecognized values so "not tracked" stays distinct', () => {
    expect(coerceBoolean(undefined)).toBeUndefined();
    expect(coerceBoolean(null)).toBeUndefined();
    expect(coerceBoolean('')).toBeUndefined();
    expect(coerceBoolean('maybe')).toBeUndefined();
  });
});

describe('coerceTimestamp', () => {
  it('converts the stringified Unix seconds Mosyle returns', () => {
    expect(coerceTimestamp('1694210851')).toBe('2023-09-08T22:07:31.000Z');
    expect(coerceTimestamp(1700000000)).toBe('2023-11-14T22:13:20.000Z');
    expect(coerceTimestamp(1700000000000)).toBe('2023-11-14T22:13:20.000Z');
  });

  it('passes through parseable ISO strings', () => {
    expect(coerceTimestamp('2024-03-01T10:00:00Z')).toBe('2024-03-01T10:00:00.000Z');
  });

  it('returns undefined for unparseable values instead of throwing', () => {
    expect(coerceTimestamp('not a date')).toBeUndefined();
    expect(coerceTimestamp(undefined)).toBeUndefined();
    expect(coerceTimestamp('')).toBeUndefined();
  });
});

describe('isDeviceActive', () => {
  it('treats the documented enrolled status as active', () => {
    expect(isDeviceActive({ status: 'IN' })).toBe(true);
    expect(isDeviceActive({})).toBe(true);
  });

  it('marks deleted devices inactive via is_deleted', () => {
    expect(isDeviceActive({ status: 'IN', is_deleted: '1' })).toBe(false);
    expect(isDeviceActive({ status: 'IN', is_deleted: '0' })).toBe(true);
  });

  it('marks retired lifecycle states inactive', () => {
    for (const status of ['OUT', 'deleted', 'unenrolled', 'wiped']) {
      expect(isDeviceActive({ status })).toBe(false);
    }
  });
});
