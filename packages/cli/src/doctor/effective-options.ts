import { dirname, join, resolve } from 'node:path';
import { readJsonFile } from '../layout/read-json-file.ts';

type Options = Readonly<Record<string, unknown>>;

/**
 * The compiler options a `tsconfig` file ends up with: its `extends` chain read from the file
 * system, each file overriding the one it extends. Undefined when the file is missing.
 */
export async function effectiveOptions(path: string, depth = 0): Promise<Options | undefined> {
  const config = await readJsonFile(path);
  if (config === undefined) return undefined;
  const own = (config.compilerOptions ?? {}) as Options;
  const parent = typeof config.extends === 'string' ? config.extends : undefined;
  if (parent === undefined || depth > 6 || !parent.startsWith('.')) return own;
  const target = resolve(dirname(path), parent.endsWith('.json') ? parent : `${parent}.json`);
  const inherited = await effectiveOptions(join(target), depth + 1);
  return { ...inherited, ...own };
}
