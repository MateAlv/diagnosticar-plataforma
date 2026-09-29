import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

/**
 * Imports TypeScript modules from src/ in plain node --test, relative imports
 * between them included: each file is transpiled next to the others in a
 * scratch directory, with `./x` rewritten to `./x.mjs`.
 *
 * Only for modules whose runtime imports are relative; `@/` aliases and
 * packages are not resolved.
 */
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

export async function importTs(...relativePaths) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ts-module-'));
  for (const relative of relativePaths) {
    const source = readFileSync(path.join(SRC, relative), 'utf8');
    const js = ts
      .transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/from (["'])(\.\/[^"']+)\1/g, (_, quote, spec) => `from ${quote}${spec}.mjs${quote}`);
    writeFileSync(path.join(dir, `${path.basename(relative, '.ts')}.mjs`), js);
  }
  const main = relativePaths.at(-1);
  return import(pathToFileURL(path.join(dir, `${path.basename(main, '.ts')}.mjs`)).href);
}
