/**
 * People-directory access for the Railway employee access check. Railway
 * accounts are commonly created by signing in with GitHub, so a linked GitHub
 * email counts.
 */

import type { CheckContext } from '../../types';
import { loadPeopleDirectory, type PeopleDirectory } from '../people-directory';

const DIRECTORY_SOURCES = ['github', 'railway'];

export function loadDirectory(ctx: CheckContext): Promise<PeopleDirectory> {
  return loadPeopleDirectory(ctx, { provider: 'Railway', sources: DIRECTORY_SOURCES });
}
