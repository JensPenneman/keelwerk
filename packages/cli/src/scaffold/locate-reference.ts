import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { usageFailure } from '../context/usage-failure.ts';

function isModuleRoot(cwd: string, root: string, id: string): boolean {
  const base = join(cwd, root, 'src', 'base.ts');
  return existsSync(base) && new RegExp(`\\bid:\\s*'${id}'`).test(readFileSync(base, 'utf8'));
}

/** An existing module package the reference points into. */
export interface LocatedModule {
  /** The package root relative to the working directory, `/` separators (`.` for the directory itself). */
  readonly root: string;
  /** The files of its `src/`, relative to `src/`, `/` separators. */
  readonly files: ReadonlySet<string>;
}

/**
 * Finds the package of module `id` (section 23.14): `--dir` when given, else `modules/<id>`,
 * `packages/module-<id>`, or the working directory itself when it is that module.
 */
export async function locateReference(
  cwd: string,
  id: string,
  dir: string | undefined,
): Promise<LocatedModule> {
  const candidates = dir === undefined ? [`modules/${id}`, `packages/module-${id}`, '.'] : [dir];
  const root = candidates.find((candidate) => isModuleRoot(cwd, candidate, id));
  if (root === undefined) {
    throw usageFailure(
      `No module "${id}" found: looked for src/base.ts declaring it in ${candidates.join(', ')}.`,
    );
  }
  const source = join(cwd, root, 'src');
  const entries = await readdir(source, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(source, join(entry.parentPath, entry.name)).split(sep).join('/'));
  return { root: root.split(sep).join('/'), files: new Set(files) };
}
