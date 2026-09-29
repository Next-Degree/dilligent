import { fetchTrust } from '@/lib/api';
import { getRewritePath } from '@/lib/host-routing';
import { resolveDomainSchema } from '@/lib/schemas';
import { NextResponse, type NextRequest } from 'next/server';

async function resolveDomain(domain: string): Promise<string | null> {
  const result = await fetchTrust({
    path: `/resolve-domain?domain=${encodeURIComponent(domain)}`,
    schema: resolveDomainSchema,
  });
  return result.ok ? result.data.friendlyUrl : null;
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const rewritePath = await getRewritePath({
    host,
    pathname: request.nextUrl.pathname,
    resolveDomain,
  });

  if (!rewritePath) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = rewritePath;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
