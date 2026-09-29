import { getApiUrl } from '@/lib/env';
import { isAllowedProxyCall } from '@/lib/proxy-allowlist';
import { NextResponse, type NextRequest } from 'next/server';

type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;

  if (!isAllowedProxyCall({ method: request.method, segments: path })) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  const target = new URL(
    `${getApiUrl()}/v1/trust-access/${path.map(encodeURIComponent).join('/')}`,
  );
  target.search = request.nextUrl.search;

  const headers = new Headers({ Accept: 'application/json' });
  const userAgent = request.headers.get('user-agent');
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (userAgent) headers.set('user-agent', userAgent);
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  let body: string | undefined;
  if (request.method === 'POST') {
    headers.set('Content-Type', 'application/json');
    body = await request.text();
  }

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
    });
    const text = await response.text();
    return new NextResponse(text || null, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return NextResponse.json({ message: 'API unreachable' }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
