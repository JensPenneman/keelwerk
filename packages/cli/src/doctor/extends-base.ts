import { dirname, resolve } from 'node:path';
import { readJsonFile } from '../layout/read-json-file.ts';

/** Whether the `extends` chain of the `tsconfig` file at `path` reaches a `tsconfig.base.json`. */
export async function extendsBase(path: string, depth = 0): Promise<boolean> {
  const config = await readJsonFile(path);
  const parent = config?.extends;
  if (typeof parent !== 'string' || depth > 6 || !parent.startsWith('.')) return false;
  const target = resolve(dirname(path), parent.endsWith('.json') ? parent : `${parent}.json`);
  return target.endsWith('/tsconfig.base.json') || extendsBase(target, depth + 1);
}
