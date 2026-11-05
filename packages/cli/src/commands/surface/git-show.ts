import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { usageFailure } from '../../context/usage-failure.ts';
import type { ReadBase } from './compare-with-base.ts';

const run = promisify(execFile);

/** A reader of files as `ref` committed them, run in `root`; an unknown ref is a usage mistake. */
export async function gitShow(root: string, ref: string): Promise<ReadBase> {
  try {
    await run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root });
  } catch {
    throw usageFailure(`"${ref}" is not a commit of the repository at ${root}.`);
  }
  return async (path) => {
    try {
      const shown = await run('git', ['show', `${ref}:${path}`], {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
      });
      return shown.stdout;
    } catch {
      return undefined;
    }
  };
}
