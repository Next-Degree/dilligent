/**
 * Mosyle API types.
 *
 * Reference: the API docs published in the Mosyle console under
 * Organization > API Integration. Every endpoint is a POST to `/v1/<resource>`
 * that names its action in an `operation` body field, and every response is
 * wrapped as `{ status, response: [payload] }`.
 *
 * Scalar values come back as strings — booleans as "1"/"0", timestamps as
 * stringified Unix seconds — so nothing here is typed as boolean or number.
 */

/** Mosyle product line — decides which API host the connection talks to. */
export type MosyleEnvironment = 'business' | 'manager';

export const MOSYLE_API_HOSTS: Record<MosyleEnvironment, string> = {
  business: 'https://businessapi.mosyle.com',
  manager: 'https://managerapi.mosyle.com',
};

/**
 * Mosyle requires an OS on every device query and returns one family at a time.
 * Only `mac` maps onto a storable device: `DevicePlatform` is macos/windows/linux,
 * so iPhones, iPads, Apple TVs and Vision Pros have no representation.
 */
export type MosyleDeviceOs = 'mac' | 'ios' | 'tvos' | 'visionos';

export const MOSYLE_DEVICE_OS_VALUES: readonly MosyleDeviceOs[] = [
  'mac',
  'ios',
  'tvos',
  'visionos',
];

export interface MosyleDevice {
  deviceudid?: string;
  serial_number?: string;
  device_name?: string;
  device_model?: string;
  device_model_name?: string;
  model_name?: string;
  osversion?: string;
  os?: string;
  /** Seat assignment — the link from a device to a person. */
  useremail?: string;
  username?: string;
  userid?: string;
  usertype?: string;
  /** Stringified Unix seconds. */
  date_last_beat?: string;
  date_checkin?: string;
  date_info?: string;
  /** Enrollment lifecycle: "IN" while enrolled. */
  status?: string;
  is_deleted?: string;
  /** Security signals, as "1"/"0" strings. */
  is_supervised?: string;
  isActivationLockEnabled?: string;
  SystemIntegrityProtectionEnabled?: string;
  has_password?: string;
  DeviceAttestationStatus?: string;
  /** Version string of a pending OS update, or null when up to date. */
  needosupdate?: string | null;
  [key: string]: unknown;
}

export interface MosyleUser {
  iduser?: string;
  name?: string;
  type?: string;
  identifier?: string;
  email?: string;
  is_removed?: boolean;
}

/**
 * One entry of the `response` array. Success payloads carry `devices`/`users`;
 * failures replace them with a `status`/`info` pair (DEVICES_NOTFOUND,
 * MISSING_DATA, UNKNOWN_COLUMNS, USERS_NOTFOUND), which is why both are optional.
 */
export interface MosylePayload {
  status?: string;
  info?: unknown;
  devices?: MosyleDevice[];
  /** Plain ids when the caller asked for `return_only_ids`, objects otherwise. */
  users?: Array<MosyleUser | number> | number;
  rows?: number | string;
  page?: number | string;
  page_size?: number | string;
  [key: string]: unknown;
}

export interface MosyleEnvelope {
  status?: string;
  response?: MosylePayload[];
  [key: string]: unknown;
}
