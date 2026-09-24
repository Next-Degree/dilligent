import { describe, expect, it } from 'bun:test';
import { appAvailabilityCheck } from '../checks/app-availability';
import { createMockContext, member } from './helpers';

describe('attio_app_availability', () => {
  it('passes when Attio answers and the token is active and correctly scoped', async () => {
    const ctx = createMockContext();
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._passes).toHaveLength(1);

    const [result] = ctx._passes;
    expect(result.resourceType).toBe('organization');
    expect(result.resourceId).toBe('acme');
    expect(result.evidence).toMatchObject({
      endpoint: '/v2/self',
      reachable: true,
      active: true,
      workspace: 'Acme',
      scopes: ['user_management:read'],
    });
  });

  it('produces evidence even when the workspace has no members', async () => {
    // The whole point of this check: an empty workspace still proves the integration
    // was live and authenticated, where the roster checks would have nothing to say.
    const ctx = createMockContext({ members: [] });
    await appAvailabilityCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._fails).toHaveLength(0);
  });

  it('never reads the member list', async () => {
    const ctx = createMockContext({ members: [member('u1')] });
    await appAvailabilityCheck.run(ctx);

    // Availability must not depend on the data the other checks fetch, or a scope
    // problem on the member list would masquerade as an outage.
    expect(ctx._paths).toEqual(['/v2/self']);
  });

  it('fails when Attio cannot be reached at all', async () => {
    const ctx = createMockContext({ selfError: new Error('getaddrinfo ENOTFOUND api.attio.com') });
    await appAvailabilityCheck.run(ctx);

    expect(ctx._passes).toHaveLength(0);
    expect(ctx._fails).toHaveLength(1);

    const [finding] = ctx._fails;
    expect(finding.severity).toBe('high');
    expect(finding.evidence).toMatchObject({ reachable: false });
    // Falls back to the stable org-level id, since no workspace slug was returned.
    expect(finding.resourceId).toBe('attio');
  });

  it('translates a revoked key into the actionable 401 message', async () => {
    const ctx = createMockContext({ selfError: new Error('Request failed with status 401') });
    await appAvailabilityCheck.run(ctx);

    const [finding] = ctx._fails;
    expect(String(finding.description)).toContain('Workspace settings > Developers');
    expect(String(finding.description)).not.toContain('status 401');
  });

  it('fails when Attio answers but reports the token as inactive', async () => {
    // A revoked token can come back as HTTP 200 with active: false, so a successful
    // request is not on its own proof the credential still works.
    const ctx = createMockContext({ self: { active: false } });
    await appAvailabilityCheck.run(ctx);

    expect(ctx._passes).toHaveLength(0);
    expect(ctx._fails).toHaveLength(1);

    const [finding] = ctx._fails;
    expect(finding.severity).toBe('high');
    expect(String(finding.title)).toContain('no longer active');
    expect(finding.evidence).toMatchObject({ reachable: true, active: false });
  });

  it('still passes reachability but flags a key missing the required scope', async () => {
    const ctx = createMockContext({ self: { scope: 'record_permission:read' } });
    await appAvailabilityCheck.run(ctx);

    // Reachability and scope are separate facts, so they get separate rows.
    expect(ctx._passes).toHaveLength(1);
    expect(ctx._fails).toHaveLength(1);

    const [finding] = ctx._fails;
    expect(finding.severity).toBe('medium');
    expect(String(finding.title)).toContain('user_management:read');
    expect(String(finding.description)).toContain('record_permission:read');
    expect(finding.evidence).toMatchObject({
      requiredScope: 'user_management:read',
      scopes: ['record_permission:read'],
    });
  });

  it('flags a key granted no scopes at all', async () => {
    const ctx = createMockContext({ self: { scope: '' } });
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails).toHaveLength(1);
    expect(String(ctx._fails[0].description)).toContain('no scopes granted');
  });

  it('accepts the required scope alongside others', async () => {
    const ctx = createMockContext({
      self: { scope: 'record_permission:read user_management:read object_configuration:read' },
    });
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._passes).toHaveLength(1);
  });

  it('does not treat a missing active field as a revoked token', async () => {
    // Only an explicit active: false means revoked; an absent field is not evidence
    // of anything, and failing on it would raise a false alarm on every run.
    const ctx = createMockContext({ self: { active: undefined } });
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._passes).toHaveLength(1);
  });

  it('falls back to a stable resourceId when the workspace slug is absent', async () => {
    const ctx = createMockContext({ self: { workspace_slug: '' } });
    await appAvailabilityCheck.run(ctx);

    expect(ctx._passes[0].resourceId).toBe('attio');
  });

  it('maps to the App Availability task and the monitoring service', () => {
    expect(appAvailabilityCheck.taskMapping).toBeTruthy();
    expect(appAvailabilityCheck.service).toBe('monitoring');
    expect(appAvailabilityCheck.id).toBe('attio_app_availability');
  });
});
