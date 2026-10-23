import { describe, expect, it } from 'bun:test';
import { registry } from '../../../registry';
import { TASK_TEMPLATES } from '../../../task-mappings';
import { dilligentManifest } from '../index';

describe('dilligent manifest', () => {
  it('is registered as a code manifest', () => {
    expect(registry.getManifest('dilligent')).toBeDefined();
    expect(registry.isCodeManifest('dilligent')).toBe(true);
  });

  it('needs no credentials, so connecting is one click', () => {
    expect(dilligentManifest.auth.type).toBe('none');
    expect(dilligentManifest.credentialFields ?? []).toHaveLength(0);
  });

  it('is opt-in: one connection per organization, checks only', () => {
    expect(dilligentManifest.supportsMultipleConnections).toBe(false);
    expect(dilligentManifest.capabilities).toEqual(['checks']);
  });

  it('feeds the Security Awareness Training task', () => {
    const mappings = dilligentManifest.checks?.map((check) => check.taskMapping);
    expect(mappings).toEqual([TASK_TEMPLATES.securityAwarenessTraining]);
  });
});
