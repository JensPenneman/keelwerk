import { readFile } from 'node:fs/promises';
import ts from 'typescript-6';

/** A JSON file with comments and trailing commas allowed (a `tsconfig.json`); undefined when it is missing or unreadable. */
export async function readJsonFile(
  path: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  const parsed = ts.parseConfigFileTextToJson(path, text);
  const config: unknown = parsed.config;
  return parsed.error === undefined && typeof config === 'object' && config !== null
    ? (config as Readonly<Record<string, unknown>>)
    : undefined;
}
