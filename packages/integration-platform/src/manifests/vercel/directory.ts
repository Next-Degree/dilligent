/**
 * People-directory access for the Vercel access-review checks. The loading
 * itself is shared (see `../people-directory.ts`); this file only states which
 * linked emails identify a person on Vercel.
 */

import type { CheckContext } from '../../types';
import { loadPeopleDirectory, type PeopleDirectory } from '../people-directory';

/**
 * Linked-email sources that identify a person on Vercel.
 *
 * `'github'` is the one that matters today, for two reasons:
 *
 *   1. `EXTERNAL_USER_SOURCES` in the API is `['github']`: GitHub is the only
 *      provider a People record can link an email for today, so `'vercel'`
 *      alone would match nothing on every run.
 *   2. It is the right address regardless. Vercel accounts are overwhelmingly
 *      created by signing in with GitHub, so a person's GitHub email IS their
 *      Vercel identity.
 *
 * `'vercel'` is listed for when People records can link one directly.
 */
const DIRECTORY_SOURCES = ['github', 'vercel'];

export function loadDirectoryByEmail(ctx: CheckContext): Promise<PeopleDirectory> {
  return loadPeopleDirectory(ctx, { provider: 'Vercel', sources: DIRECTORY_SOURCES });
}
