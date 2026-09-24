import type { InboxSource, InboxSourceContext } from './inbox-source';
import type { InboxItem, InboxItemKind, InboxSeverity } from './inbox.types';

const resolveCallerPermissions = jest.fn();
jest.mock('./inbox-permissions', () => ({ resolveCallerPermissions }));

const mockSources: InboxSource[] = [];
jest.mock('./sources', () => ({ INBOX_SOURCES: mockSources }));

import type { AuthContext } from '../auth/types';
import { InboxService, PER_SOURCE_LIMIT } from './inbox.service';

const AUTH: AuthContext = {
  organizationId: 'org_1',
  authType: 'session',
  isApiKey: false,
  isPlatformAdmin: false,
  userRoles: ['auditor'],
};

function item(
  kind: InboxItemKind,
  id: string,
  severity: InboxSeverity,
  occurredAt: string,
): InboxItem {
  return {
    key: `v1:${kind}:${id}`,
    kind,
    severity,
    title: id,
    detail: '',
    path: '',
    occurredAt: new Date(occurredAt),
    assigneeMemberId: null,
  };
}

function source(
  kind: InboxItemKind,
  resource: string,
  items: InboxItem[],
  total = items.length,
): InboxSource & { collect: jest.Mock } {
  return {
    kind,
    requires: [{ resource, action: 'read' }],
    collect: jest.fn().mockResolvedValue({ items, total }),
  };
}

function allow(...grants: string[]) {
  resolveCallerPermissions.mockResolvedValue(
    (resource: string, action: string) =>
      grants.includes(`${resource}:${action}`),
  );
}

describe('InboxService', () => {
  const service = new InboxService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockSources.length = 0;
  });

  it('runs only the sources the caller may read, and omits the rest from totals', async () => {
    const tasks = source('task-failed', 'task', [
      item('task-failed', 't1', 'critical', '2026-09-01'),
    ]);
    const connections = source('connection-error', 'integration', [
      item('connection-error', 'c1', 'critical', '2026-09-02'),
    ]);
    mockSources.push(tasks, connections);
    allow('task:read');

    const result = await service.list({ auth: AUTH, limit: 100 });

    expect(connections.collect).not.toHaveBeenCalled();
    expect(result.items.map((i) => i.kind)).toEqual(['task-failed']);
    expect(result.totals).toEqual({ 'task-failed': 1 });
    expect('connection-error' in result.totals).toBe(false);
  });

  it('requires every permission a source declares', async () => {
    const guarded: InboxSource & { collect: jest.Mock } = {
      ...source('task-failed', 'task', []),
      requires: [
        { resource: 'task', action: 'read' },
        { resource: 'integration', action: 'read' },
      ],
    };
    mockSources.push(guarded);
    allow('task:read');

    await service.list({ auth: AUTH, limit: 100 });

    expect(guarded.collect).not.toHaveBeenCalled();
  });

  it('passes the organization, caller and a capped per-source limit to each source', async () => {
    const tasks = source('task-failed', 'task', []);
    mockSources.push(tasks);
    allow('task:read');

    await service.list({ auth: AUTH, limit: 250 });
    await service.list({ auth: AUTH, limit: 10 });

    const contexts = tasks.collect.mock.calls.map(
      ([ctx]: [InboxSourceContext]) => ctx,
    );
    expect(contexts[0]).toEqual({
      organizationId: 'org_1',
      limit: PER_SOURCE_LIMIT,
      auth: AUTH,
    });
    expect(contexts[1].limit).toBe(10);
  });

  it('ranks by severity, then most recent first, across sources', async () => {
    mockSources.push(
      source('task-failed', 'task', [
        item('task-failed', 'old-critical', 'critical', '2026-09-01'),
        item('task-failed', 'new-attention', 'attention', '2026-09-20'),
      ]),
      source('connection-error', 'integration', [
        item('connection-error', 'new-critical', 'critical', '2026-09-10'),
        item('connection-error', 'routine', 'routine', '2026-09-21'),
      ]),
    );
    allow('task:read', 'integration:read');

    const { items } = await service.list({ auth: AUTH, limit: 100 });

    expect(items.map((i) => i.title)).toEqual([
      'new-critical',
      'old-critical',
      'new-attention',
      'routine',
    ]);
  });

  it('truncates to the limit while totals keep the true counts', async () => {
    mockSources.push(
      source(
        'task-failed',
        'task',
        [
          item('task-failed', 'a', 'critical', '2026-09-03'),
          item('task-failed', 'b', 'critical', '2026-09-02'),
          item('task-failed', 'c', 'critical', '2026-09-01'),
        ],
        40,
      ),
    );
    allow('task:read');

    const result = await service.list({ auth: AUTH, limit: 2 });

    expect(result.items.map((i) => i.title)).toEqual(['a', 'b']);
    expect(result.totals).toEqual({ 'task-failed': 40 });
  });

  it('returns an empty inbox when the caller may read nothing', async () => {
    mockSources.push(source('task-failed', 'task', []));
    allow();

    await expect(service.list({ auth: AUTH, limit: 100 })).resolves.toEqual({
      items: [],
      totals: {},
    });
  });
});
