import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeclarationSize } from './declaration-size.ts';

/** The size of the `.d.ts` files below `<root>/<dir>/dist`; undefined when the package is not built. */
export async function measureDeclarations(
  root: string,
  dir: string,
): Promise<DeclarationSize | undefined> {
  const dist = join(root, dir, 'dist');
  const entries = await readdir(dist, { recursive: true, withFileTypes: true }).catch(
    () => undefined,
  );
  if (entries === undefined) return undefined;
  let manifestBytes = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
    const bytes = (await stat(join(entry.parentPath, entry.name))).size;
    totalBytes += bytes;
    if (entry.name === 'module.generated.d.ts') manifestBytes = bytes;
  }
  return { dir, manifestBytes, totalBytes };
}
