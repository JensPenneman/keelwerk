import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isLayoutSource } from './is-layout-source.ts';
import { parseSource } from './parse-source.ts';
import type { ParsedSource } from './parsed-source.ts';

/** Parses every layout source of `files` (relative to `sourceDir`) below the workspace root. */
export async function parseSources(
  root: string,
  sourceDir: string,
  files: readonly string[],
): Promise<Map<string, ParsedSource>> {
  const sources = new Map<string, ParsedSource>();
  for (const file of files.filter(isLayoutSource)) {
    const text = await readFile(join(root, sourceDir, file), 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    sources.set(file, parseSource(`${sourceDir}/${file}`, text));
  }
  return sources;
}
