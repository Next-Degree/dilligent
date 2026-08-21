# OpenSpec Conventions

Spec-driven development for this repo. Specs describe **what the system does**;
code is the implementation detail.

## Layout

```
openspec/
├── project.md          # Repo-level context every change assumes
├── specs/              # Source of truth — current, shipped behavior
│   └── <capability>/spec.md
└── changes/            # In-flight proposals
    ├── <change-id>/
    │   ├── proposal.md # Why / What Changes / Impact
    │   ├── design.md   # Technical approach + decisions (when non-obvious)
    │   ├── tasks.md    # Implementation checklist
    │   └── specs/
    │       └── <capability>/spec.md   # DELTA against openspec/specs/
    └── archive/        # Completed changes, moved here after merge
```

## Change IDs

Verb-led kebab-case: `add-data-source-evaluation`, `update-risk-scoring`,
`remove-legacy-server-actions`.

## Delta format

Files under `changes/<id>/specs/` are **deltas**, not full specs. Group
requirements under exactly one of:

- `## ADDED Requirements` — behavior not previously specified
- `## MODIFIED Requirements` — behavior that changes (restate the requirement in full)
- `## REMOVED Requirements` — behavior being retired
- `## Purpose` — only when the capability is brand new

Within a group:

```markdown
### Requirement: Descriptive Name
The system SHALL <single observable behavior>.

#### Scenario: Specific case name
- **GIVEN** <initial state>
- **WHEN** <action>
- **THEN** <observable outcome>
```

Rules:

1. **One behavior per requirement.** One `SHALL`/`MUST` per requirement heading.
2. **At least one scenario per requirement.** No exceptions.
3. **Observable language.** Verifiable without reading source code.
4. **No implementation detail.** Table names, class names, and library choices
   belong in `design.md`.
5. **RFC 2119 keywords.** `MUST`/`SHALL` = mandatory, `SHOULD` = justified
   exceptions allowed, `MAY` = optional.

## Workflow

1. Write `proposal.md` — get agreement on *why* and *scope* before design.
2. Write `design.md` when the approach is non-obvious or contested.
3. Write spec deltas — the contract the implementation must satisfy.
4. Write `tasks.md` — numbered `1.1`, `1.2`, each small enough for one sitting.
5. Implement, checking off tasks.
6. On merge, fold deltas into `openspec/specs/` and move the change to
   `changes/archive/`.

## House rules that override generic OpenSpec advice

- Repo conventions in `/CLAUDE.md` win: bun, ≤300 lines/file, no `as any`,
  no `@ts-ignore`, RBAC on every customer-facing endpoint, tests with every
  feature.
- Any requirement that touches a customer-facing API endpoint MUST have a
  scenario covering the unauthorized case.
