import type { CheckContext } from '../../types';
import {
  authHeaders,
  credential,
  extractLoginToken,
  extractUsers,
  payloadRows,
  resolveApiHost,
  resolveEnvironment,
  unwrapEnvelope,
} from './parse';
import type { MosyleDevice, MosyleDeviceOs, MosyleEnvelope, MosyleUser } from './types';

/** Mosyle defaults to 50 per page; ask for more to keep large fleets cheap. */
const PAGE_SIZE = 500;

/**
 * Hard stop on pagination. A tenant whose API ignores `page` would otherwise
 * loop forever, so cap the walk and warn instead of hanging the sync run.
 */
const MAX_PAGES = 400;

/**
 * Exchanges the admin email/password plus API access token for a JWT.
 *
 * The access token authenticates the *integration* and the login authenticates
 * the *admin*; every other endpoint requires both. Tokens expire after 24h,
 * which is well beyond a single sync run, so nothing is cached.
 */
export async function login(ctx: CheckContext): Promise<string> {
  const host = resolveApiHost(ctx.credentials);
  const accessToken = credential(ctx.credentials, 'access_token');
  const email = credential(ctx.credentials, 'admin_email');
  const password = credential(ctx.credentials, 'admin_password');

  if (!accessToken) throw new Error('Mosyle access token is missing from the connection');
  if (!email || !password) {
    throw new Error('Mosyle admin email and password are required to obtain a session token');
  }

  ctx.log(`Authenticating with Mosyle (${resolveEnvironment(ctx.credentials)})`);

  if (!ctx.postRaw) {
    throw new Error('Mosyle requires response-header access, which this runtime does not provide');
  }

  // postRaw, not post: the JWT is returned in a header the JSON body omits.
  const response = await ctx.postRaw(
    '/v1/login',
    { email, password },
    { baseUrl: host, headers: { accessToken, 'Content-Type': 'application/json' } },
  );

  const token = extractLoginToken(response.headers, response.body);
  if (!token) {
    throw new Error(
      'Mosyle login succeeded but returned no Authorization token — confirm the API profile is enabled and uses JWT authentication',
    );
  }

  return token;
}

/**
 * Walks every page of `/v1/devices` for one OS family.
 *
 * Terminates on a short page, an empty page, or once the accumulated count
 * reaches the `rows` total Mosyle reports — so a tenant that ignores `page`
 * cannot spin.
 */
export async function listDevices(
  ctx: CheckContext,
  { os, jwt }: { os: MosyleDeviceOs; jwt: string },
): Promise<MosyleDevice[]> {
  const host = resolveApiHost(ctx.credentials);
  const headers = authHeaders(credential(ctx.credentials, 'access_token'), jwt);
  const devices: MosyleDevice[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const envelope = await ctx.post<MosyleEnvelope>(
      '/v1/devices',
      { operation: 'list', options: { os, page, page_size: PAGE_SIZE } },
      { baseUrl: host, headers },
    );

    const payloads = unwrapEnvelope(envelope);
    const pageDevices = payloads.flatMap((payload) =>
      Array.isArray(payload.devices) ? payload.devices : [],
    );
    devices.push(...pageDevices);

    if (pageDevices.length < PAGE_SIZE) return devices;

    const rows = payloadRows(payloads);
    if (rows !== undefined && devices.length >= rows) return devices;

    if (page === MAX_PAGES) {
      ctx.warn(
        `Stopped paginating Mosyle ${os} devices at ${MAX_PAGES} pages — results may be truncated`,
      );
    }
  }

  return devices;
}

/**
 * Lists end users so devices that report a `userid` but no `useremail` can
 * still be matched to a member. Best-effort: a failure here degrades matching
 * for those devices rather than failing the sync.
 */
export async function listUsers(ctx: CheckContext, jwt: string): Promise<MosyleUser[]> {
  const host = resolveApiHost(ctx.credentials);
  const headers = authHeaders(credential(ctx.credentials, 'access_token'), jwt);
  const users: MosyleUser[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const envelope = await ctx.post<MosyleEnvelope>(
      '/v1/users',
      { operation: 'list_users', options: { page, page_size: PAGE_SIZE } },
      { baseUrl: host, headers },
    );

    const pageUsers = extractUsers(envelope);
    users.push(...pageUsers);

    if (pageUsers.length < PAGE_SIZE) return users;
  }

  return users;
}
