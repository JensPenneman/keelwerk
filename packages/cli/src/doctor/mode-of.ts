import { stat } from 'node:fs/promises';

/** The permission bits of a path; undefined when it does not exist. */
export async function modeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o777;
  } catch {
    return undefined;
  }
}
