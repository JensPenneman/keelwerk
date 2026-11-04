import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HostFiles } from '../context/cli-host.ts';

function isMissing(failure: unknown): boolean {
  return failure instanceof Error && 'code' in failure && failure.code === 'ENOENT';
}

/** The real file system. Files are written whole to a new file with exactly the requested mode and renamed over the target, parents with 0700. */
export const nodeHostFiles: HostFiles = {
  async readText(path) {
    try {
      return await readFile(path, 'utf8');
    } catch (failure) {
      if (isMissing(failure)) {
        return undefined;
      }
      throw failure;
    }
  },
  async readBytes(path) {
    return new Uint8Array(await readFile(path));
  },
  async writeText(path, text, mode) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text, { mode, flag: 'wx' });
      await chmod(temporary, mode);
      await rename(temporary, path);
    } catch (failure) {
      await rm(temporary, { force: true });
      throw failure;
    }
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (failure) {
      if (isMissing(failure)) {
        return false;
      }
      throw failure;
    }
  },
};
