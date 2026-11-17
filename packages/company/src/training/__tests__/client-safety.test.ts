import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The training modules are imported by client components (through the
// `@trycompai/company/training` subpath) and by packages that have no database
// of their own. The main entry pulls in `@trycompai/db`, so nothing under
// `training/` may reach outside its own folder.

const TRAINING_DIR = join(import.meta.dir, '..');

const sourceFiles = readdirSync(TRAINING_DIR).filter((file) => file.endsWith('.ts'));

const importSpecifiers = (source: string): string[] =>
  [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

describe('training modules are client safe', () => {
  it('finds the modules to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(5);
  });

  for (const file of sourceFiles) {
    it(`${file} only imports from within the training folder`, () => {
      const source = readFileSync(join(TRAINING_DIR, file), 'utf8');

      for (const specifier of importSpecifiers(source)) {
        expect(specifier.startsWith('./')).toBe(true);
      }
    });
  }
});
