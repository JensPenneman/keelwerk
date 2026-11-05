import { readFile } from 'node:fs/promises';

/** The text of a file, or `undefined` when it does not exist. */
export async function readIfPresent(path: string): Promise<string | undefined> {
  return readFile(path, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
}
