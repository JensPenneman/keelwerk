import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { usageFailure } from '../context/usage-failure.ts';
import type { ScaffoldFile } from './scaffold-file.ts';

function isExisting(failure: unknown): boolean {
  return failure instanceof Error && 'code' in failure && failure.code === 'EEXIST';
}

/**
 * Creates the files under `cwd`. A file that exists is never overwritten (decision 59b): the
 * scaffold stops with a usage error, naming the file, before it writes anything after it.
 */
export async function writeScaffold(cwd: string, files: readonly ScaffoldFile[]): Promise<void> {
  for (const file of files) {
    if (existsSync(join(cwd, file.path))) {
      throw usageFailure(`${file.path} already exists; a scaffold never overwrites a file.`);
    }
  }
  for (const file of files) {
    const target = join(cwd, file.path);
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(target, file.text, { encoding: 'utf8', flag: 'wx' });
    } catch (failure) {
      if (isExisting(failure)) {
        throw usageFailure(`${file.path} already exists; a scaffold never overwrites a file.`);
      }
      throw failure;
    }
  }
}
