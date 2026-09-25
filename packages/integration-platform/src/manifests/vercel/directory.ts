/**
 * People-directory access for the Vercel access-review checks.
 */

import type { CheckContext } from '../../types';
import { loadPeopleDirectory, type PeopleDirectory } from '../people-directory';

/**
 * Linked-email sources that identify a person on Vercel. Vercel accounts are
 * mostly created by signing in with GitHub, so a linked GitHub email identifies
 * the person (and GitHub is the only source People can link today). `vercel`
 * is listed for when People records can link one directly.
 */
const DIRECTORY_SOURCES = ['github', 'vercel'];

export function loadDirectory(ctx: CheckContext): Promise<PeopleDirectory> {
  return loadPeopleDirectory(ctx, { provider: 'Vercel', sources: DIRECTORY_SOURCES });
}
