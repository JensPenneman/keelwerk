import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The `version` of an installed package below `directory`'s `node_modules`; undefined when it is not installed. */
export async function installedVersion(
  directory: string,
  name: string,
): Promise<string | undefined> {
  try {
    const text = await readFile(join(directory, 'node_modules', name, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(text);
    const version = (parsed as { version?: unknown } | null)?.version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}
