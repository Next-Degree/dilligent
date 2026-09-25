import { describe, expect, it } from 'bun:test';
import type { CheckContext, DirectoryPerson } from '../../types';
import { loadPeopleDirectory, normalizeEmail } from '../people-directory';

const person = (
  overrides: Partial<DirectoryPerson> & { id: string; email: string },
): DirectoryPerson => ({
  linkedEmails: [],
  name: null,
  isActive: true,
  department: null,
  jobTitle: null,
  offboardDate: null,
  ...overrides,
});

const makeCtx = (listPeople?: () => Promise<DirectoryPerson[]>) => {
  const warnings: string[] = [];
  const logs: string[] = [];
  const ctx = {
    directory: listPeople ? { listPeople } : undefined,
    warn: (message: string) => warnings.push(message),
    log: (message: string) => logs.push(message),
  } as unknown as CheckContext;
  return { ctx, warnings, logs };
};

const options = { provider: 'Acme', sources: ['github', 'acme'] };

describe('loadPeopleDirectory', () => {
  it('reports unavailable, never an empty roster, when the host supplies no directory', async () => {
    const { ctx, warnings } = makeCtx();
    const directory = await loadPeopleDirectory(ctx, options);
    expect(directory.available).toBe(false);
    expect(directory.people).toEqual([]);
    expect(warnings[0]).toContain('No People directory');
  });

  it('reports unavailable when reading the directory throws', async () => {
    const { ctx, warnings } = makeCtx(() => Promise.reject(new Error('boom')));
    const directory = await loadPeopleDirectory(ctx, options);
    expect(directory.available).toBe(false);
    expect(warnings[0]).toContain('boom');
  });

  it('keys people by primary email and by linked emails from the given sources only', async () => {
    const alice = person({
      id: 'a',
      email: 'alice@corp.com',
      linkedEmails: [
        { source: 'github', email: 'Alice@Personal.dev ' },
        { source: 'acme', email: 'alice@acme-login.dev' },
        { source: 'okta', email: 'alice@okta-only.dev' },
      ],
    });
    const { ctx, logs } = makeCtx(async () => [alice]);
    const directory = await loadPeopleDirectory(ctx, options);

    expect(directory.available).toBe(true);
    expect(directory.people).toEqual([alice]);
    expect(directory.byEmail.get('alice@corp.com')).toBe(alice);
    expect(directory.byEmail.get('alice@personal.dev')).toBe(alice);
    expect(directory.byEmail.get('alice@acme-login.dev')).toBe(alice);
    expect(directory.byEmail.has('alice@okta-only.dev')).toBe(false);
    expect(logs[0]).toContain('2 linked Acme email(s)');
  });

  it('lets an active record win an email collision regardless of order', async () => {
    const leaver = person({ id: 'old', email: 'sam@corp.com', isActive: false });
    const rehire = person({ id: 'new', email: 'sam@corp.com', isActive: true });

    for (const people of [
      [leaver, rehire],
      [rehire, leaver],
    ]) {
      const { ctx } = makeCtx(async () => people);
      const directory = await loadPeopleDirectory(ctx, options);
      expect(directory.byEmail.get('sam@corp.com')?.id).toBe('new');
    }
  });

  it('keeps the first match and warns when two active records claim one email', async () => {
    const first = person({ id: '1', email: 'shared@corp.com' });
    const second = person({ id: '2', email: 'shared@corp.com' });
    const { ctx, warnings } = makeCtx(async () => [first, second]);
    const directory = await loadPeopleDirectory(ctx, options);
    expect(directory.byEmail.get('shared@corp.com')?.id).toBe('1');
    expect(warnings.some((w) => w.includes('more than one person'))).toBe(true);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases, mapping missing values to an empty string', () => {
    expect(normalizeEmail('  Bob@Corp.COM ')).toBe('bob@corp.com');
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });
});
