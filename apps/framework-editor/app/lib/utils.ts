import { headers } from 'next/headers';
import { auth } from './auth';
import { isInternalUser } from './internal-user';

export { ALLOWED_DOMAIN, isInternalUser } from './internal-user';

export function formatEnumValue(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function isAuthorized(): Promise<boolean> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) return false;

  return session.user.role === 'admin' && isInternalUser(session.user.email);
}
