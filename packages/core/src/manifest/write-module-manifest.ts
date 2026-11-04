import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import process from 'node:process';

/**
 * Writes `text` to `path` through a temporary file and a rename, so the type checker and the
 * editor never see a half-written manifest, and only when the content differs, so an unchanged
 * manifest keeps its modification time and starts no watch cycle. Returns whether it wrote.
 */
export async function writeModuleManifest(path: string, text: string): Promise<boolean> {
  const current = await readFile(path, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (current === text) return false;
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, path);
  return true;
}
