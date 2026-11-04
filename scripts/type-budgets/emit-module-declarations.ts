import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkDeclarationSizes, type DeclarationSize } from './check-declaration-sizes.ts';
import { checkEmitErrors } from './check-emit-errors.ts';
import { portabilityCodes } from './portability-codes.ts';
import { runTsc } from './run-tsc.ts';
import { throwOnCompileErrors } from './throw-on-compile-errors.ts';

const SKIPPED = new Set(['node_modules', 'dist']);
// The module roots of the manifest generator: packages/module-*, **/fixtures/modules/*, examples/*/modules/*.
const MODULE_ROOTS: readonly RegExp[] = [
  /^packages\/module-[^/]+$/,
  /(^|\/)fixtures\/modules\/[^/]+$/,
  /^examples\/[^/]+\/modules\/[^/]+$/,
];

function walk(repo: string, directory: string, found: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIPPED.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    const shown = relative(repo, path).split(sep).join('/');
    if (
      MODULE_ROOTS.some((pattern) => pattern.test(shown)) &&
      existsSync(join(path, 'src', 'base.ts'))
    ) {
      found.push(shown);
    } else {
      walk(repo, path, found);
    }
  }
}

function sources(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sources(path));
    else if (entry.name.endsWith('.ts') && !/\.test(-d)?\.ts$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** The module roots under `packages` and `examples`, relative to the repository, sorted. */
function moduleRoots(repo: string): readonly string[] {
  const found: string[] = [];
  for (const searched of ['packages', 'examples']) {
    if (existsSync(join(repo, searched))) walk(repo, join(repo, searched), found);
  }
  return found.toSorted();
}

/** The declaration sizes of every module root and the portability errors the emit printed. */
export interface ModuleDeclarations {
  readonly sizes: readonly DeclarationSize[];
  readonly portability: readonly string[];
}

/**
 * Emits the declarations of every module root in one program into `scratch` and measures each
 * root's `src`. The emit is the one a package build writes: sources resolve as in `tsc -b`.
 */
export function emitModuleDeclarations(repo: string, scratch: string): ModuleDeclarations {
  const roots = moduleRoots(repo);
  if (roots.length === 0) return { sizes: [], portability: [] };
  const out = join(scratch, 'module-declarations');
  const config = join(scratch, 'tsconfig.modules.json');
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(repo, 'tsconfig.base.json'),
      compilerOptions: {
        composite: false,
        declaration: true,
        declarationMap: false,
        sourceMap: false,
        emitDeclarationOnly: true,
        rootDir: repo,
        outDir: out,
        typeRoots: [join(repo, 'node_modules', '@types')],
      },
      files: roots.flatMap((root) => sources(join(repo, root, 'src'))),
    }),
  );
  const output = runTsc(repo, ['-p', config], repo);
  throwOnCompileErrors('the module declaration emit', output, portabilityCodes);
  return {
    sizes: roots.map((root) => checkDeclarationSizes(root, join(out, root, 'src'))),
    portability: checkEmitErrors(output),
  };
}
