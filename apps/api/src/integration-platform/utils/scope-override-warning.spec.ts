import {
  findScopesDroppedByOverride,
  scopeOverrideWarning,
} from './scope-override-warning';

const MANIFEST_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.security',
];

describe('findScopesDroppedByOverride', () => {
  it('reports nothing when no override is configured', () => {
    expect(
      findScopesDroppedByOverride({
        configuredScopes: [],
        manifestScopes: MANIFEST_SCOPES,
      }),
    ).toEqual([]);
  });

  it('reports nothing when the override already covers every manifest scope', () => {
    expect(
      findScopesDroppedByOverride({
        configuredScopes: [...MANIFEST_SCOPES, 'https://example.com/extra'],
        manifestScopes: MANIFEST_SCOPES,
      }),
    ).toEqual([]);
  });

  it('reports a manifest scope an existing override would silently drop', () => {
    // The failure this guards: a scope added to a manifest is simply never requested on
    // any deployment holding an override, because overrides replace rather than extend.
    expect(
      findScopesDroppedByOverride({
        configuredScopes: [MANIFEST_SCOPES[0]],
        manifestScopes: MANIFEST_SCOPES,
      }),
    ).toEqual([MANIFEST_SCOPES[1]]);
  });
});

describe('scopeOverrideWarning', () => {
  it('names the provider, the source and every dropped scope', () => {
    const message = scopeOverrideWarning({
      providerSlug: 'google-workspace',
      source: 'platform',
      droppedScopes: [MANIFEST_SCOPES[1]],
    });

    expect(message).toContain('google-workspace');
    expect(message).toContain('platform');
    expect(message).toContain(MANIFEST_SCOPES[1]);
    expect(message).toContain('replace');
  });
});
