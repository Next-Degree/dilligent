/**
 * Pure parsing for Mosyle responses — envelope unwrapping, credential reading,
 * and field coercion. Kept apart from `client.ts` so every branch here is
 * unit-testable without an HTTP context.
 */
import {
  MOSYLE_API_HOSTS,
  type MosyleDevice,
  type MosyleEnvelope,
  type MosyleEnvironment,
  type MosylePayload,
  type MosyleUser,
} from './types';

/** Sub-statuses Mosyle returns in place of a result set. */
const EMPTY_RESULT_STATUSES = new Set(['DEVICES_NOTFOUND', 'USERS_NOTFOUND']);

// ============================================================================
// Credential helpers (pure)
// ============================================================================

/** Credentials arrive as `string | string[]`; every Mosyle field is scalar. */
export function credential(credentials: Record<string, string | string[]>, key: string): string {
  const value = credentials[key];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Mosyle ships as two products on two hosts. Anything other than an explicit
 * `manager` selection resolves to Business, the tenant type the setup
 * instructions describe.
 */
export function resolveEnvironment(
  credentials: Record<string, string | string[]>,
): MosyleEnvironment {
  return credential(credentials, 'environment').toLowerCase() === 'manager'
    ? 'manager'
    : 'business';
}

export function resolveApiHost(credentials: Record<string, string | string[]>): string {
  return MOSYLE_API_HOSTS[resolveEnvironment(credentials)];
}

// ============================================================================
// Envelope handling (pure)
// ============================================================================

/**
 * Unwraps `{ status, response: [payload] }` into the payload entries.
 *
 * Entries whose `status` marks an empty result are dropped, so a
 * DEVICES_NOTFOUND page reads as "no devices" rather than an error. Any other
 * non-OK status throws — MISSING_DATA and UNKNOWN_COLUMNS mean the request was
 * malformed, and silently returning nothing would look like an empty fleet.
 */
export function unwrapEnvelope(envelope: MosyleEnvelope | null | undefined): MosylePayload[] {
  if (!envelope || typeof envelope !== 'object') return [];
  if (!Array.isArray(envelope.response)) return [];

  const payloads: MosylePayload[] = [];

  for (const payload of envelope.response) {
    if (!payload || typeof payload !== 'object') continue;

    const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : undefined;

    if (status && EMPTY_RESULT_STATUSES.has(status)) continue;

    if (status && status !== 'OK') {
      const info = typeof payload.info === 'string' ? `: ${payload.info}` : '';
      throw new Error(`Mosyle API returned ${status}${info}`);
    }

    payloads.push(payload);
  }

  return payloads;
}

export function extractDevices(envelope: MosyleEnvelope | null | undefined): MosyleDevice[] {
  const devices: MosyleDevice[] = [];
  for (const payload of unwrapEnvelope(envelope)) {
    if (Array.isArray(payload.devices)) devices.push(...payload.devices);
  }
  return devices;
}

/** Only object-shaped users are usable; `return_only_ids` responses are ignored. */
export function extractUsers(envelope: MosyleEnvelope | null | undefined): MosyleUser[] {
  const users: MosyleUser[] = [];
  for (const payload of unwrapEnvelope(envelope)) {
    if (!Array.isArray(payload.users)) continue;
    for (const user of payload.users) {
      if (user && typeof user === 'object') users.push(user);
    }
  }
  return users;
}

/**
 * Reads the JWT from a login response.
 *
 * Mosyle returns it only in the `Authorization` response header, as
 * "Bearer <token>"; the body carries just the user id and email. The body
 * fallbacks cover tenants that also echo it there.
 */
export function extractLoginToken(
  headers: Record<string, string> | undefined,
  body?: unknown,
): string | null {
  const bodyRecord = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  const candidates = [
    headers?.authorization,
    bodyRecord.Authorization,
    bodyRecord.authorization,
    bodyRecord.access_token,
    bodyRecord.token,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const token = candidate.replace(/^Bearer\s+/i, '').trim();
    if (token) return token;
  }

  return null;
}

// ============================================================================
// Field coercion (pure)
// ============================================================================

/**
 * Mosyle reports booleans as "1"/"0" strings, but tenants and fields vary.
 * Returns undefined for absent fields so "not reported" stays distinct from
 * "reported false" — the UI renders the two differently.
 */
export function coerceBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled', 'active'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled', 'inactive'].includes(normalized)) return false;
  }

  return undefined;
}

/**
 * Mosyle timestamps are Unix seconds, usually stringified. Returns an ISO
 * string (what `SyncDeviceSchema.lastSeenAt` requires) or undefined — an
 * unparseable date must not drop the whole device.
 */
export function coerceTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  if (typeof value === 'number') {
    // Seconds vs milliseconds: anything below this threshold is seconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && value.trim() !== '') return coerceTimestamp(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  return undefined;
}

/** Mosyle marks enrolled devices "IN" and retired ones via `is_deleted`. */
export function isDeviceActive(device: MosyleDevice): boolean {
  if (coerceBoolean(device.is_deleted) === true) return false;

  const status = typeof device.status === 'string' ? device.status.trim().toUpperCase() : '';
  if (!status) return true;

  return !['OUT', 'DELETED', 'REMOVED', 'UNENROLLED', 'WIPED', 'RETIRED'].includes(status);
}

/** Headers every post-login Mosyle request carries. */
export function authHeaders(accessToken: string, jwt: string): Record<string, string> {
  return {
    accessToken,
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  };
}

/** Reads the total row count Mosyle reports for a page, when it reports one. */
export function payloadRows(payloads: MosylePayload[]): number | undefined {
  for (const payload of payloads) {
    const rows = Number(payload.rows);
    if (!Number.isNaN(rows)) return rows;
  }
  return undefined;
}
