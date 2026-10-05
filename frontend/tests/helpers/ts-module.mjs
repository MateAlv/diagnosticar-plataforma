import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

/**
 * Imports TypeScript modules from src/ in plain node --test, relative imports
 * between them included: each file is transpiled next to the others in a
 * scratch directory, with `./x` rewritten to `./x.mjs`.
 *
 * Local imports (`./x`, `../x`, `@/x`) are flattened to siblings in the scratch
 * directory, so list every local module a file imports. Packages resolve from
 * the frontend's node_modules, where the scratch directory lives. `.tsx` files
 * are accepted, for rendering a component with react-dom/server.
 */
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const SCRATCH = fileURLToPath(new URL('../../node_modules/.cache/ts-module/', import.meta.url));
const base = (relative) => path.basename(relative).replace(/\.tsx?$/, '');

export async function importTs(...relativePaths) {
  mkdirSync(SCRATCH, { recursive: true });
  const dir = mkdtempSync(path.join(SCRATCH, 'm-'));
  for (const relative of relativePaths) {
    const source = readFileSync(path.join(SRC, relative), 'utf8');
    const js = ts
      .transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      })
      .outputText.replace(/from (["'])((?:\.{1,2}\/|@\/)[^"']+)\1/g, (_, quote, spec) => `from ${quote}./${base(spec)}.mjs${quote}`);
    writeFileSync(path.join(dir, `${base(relative)}.mjs`), js);
  }
  const main = relativePaths.at(-1);
  return import(pathToFileURL(path.join(dir, `${base(main)}.mjs`)).href);
}
